import { useEffect, useState, type FormEvent } from "react";
import { ArrowClockwise, ArrowLeft, CheckCircle, EnvelopeSimple, SignOut, Ticket, UserCircle, X } from "@phosphor-icons/react";
import type { EmailCodeChallenge, ServerSession } from "../services/tauriServerSessionService";
import {
  logoutServerSession,
  redeemServerCreditCode,
  requestServerEmailCode,
  verifyServerEmailCode,
} from "../services/tauriServerSessionService";

interface AccountDialogProps {
  open: boolean;
  session: ServerSession;
  appVersion: string;
  checkingUpdate: boolean;
  onClose: () => void;
  onCheckUpdate: () => void;
  onSessionChange: (session: ServerSession) => void;
}

export function AccountDialog({
  open,
  session,
  appVersion,
  checkingUpdate,
  onClose,
  onCheckUpdate,
  onSessionChange,
}: AccountDialogProps) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<EmailCodeChallenge>();
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemSuccess, setRedeemSuccess] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setEmail(session.email ?? "");
    setDisplayName(session.displayName ?? "");
    setCode("");
    setChallenge(undefined);
    setRedeemCode("");
    setRedeemSuccess(undefined);
    setError(undefined);
  }, [open, session.displayName, session.email]);

  if (!open) return null;

  const sendCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await requestServerEmailCode(email);
      setChallenge(result);
      setCode("");
    } catch (reason) {
      setError(errorMessage(reason, "验证码发送失败"));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await verifyServerEmailCode({
        email,
        challengeId: challenge.challengeId,
        code,
        displayName,
      });
      onSessionChange(result);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, "邮箱登录失败"));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await logoutServerSession();
      onSessionChange({ authenticated: false });
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, "退出登录失败"));
    } finally {
      setBusy(false);
    }
  };

  const redeemCredits = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedCode = redeemCode.trim().toUpperCase();
    if (normalizedCode.length < 10 || normalizedCode.length > 64) {
      setError("请输入有效的额度兑换码");
      return;
    }
    setBusy(true);
    setError(undefined);
    setRedeemSuccess(undefined);
    try {
      const result = await redeemServerCreditCode(normalizedCode);
      onSessionChange(result.session);
      setRedeemCode("");
      setRedeemSuccess(`兑换成功，已增加 ${formatCredits(result.redeemedCredits)} 积分`);
    } catch (reason) {
      setError(errorMessage(reason, "兑换码兑换失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
        <header className="account-dialog-header">
          <span className="account-dialog-icon"><UserCircle weight="fill" /></span>
          <span>
            <small>UNMIND ACCOUNT</small>
            <strong id="account-dialog-title">{session.authenticated ? "账号与额度" : "登录 Inspiration Drawer"}</strong>
          </span>
          <button className="dialog-close-action" type="button" onClick={onClose} aria-label="关闭账号窗口"><X /></button>
        </header>

        {session.authenticated ? (
          <div className="account-session-view">
            <div className="account-identity">
              <CheckCircle weight="fill" />
              <span>
                <strong>{session.displayName || "Inspiration Drawer 用户"}</strong>
                <small>{session.email}</small>
              </span>
            </div>
            <div className="credit-balance">
              <small>桌面端与移动端共享额度</small>
              <strong>{formatCredits(session.availableCredits)}</strong>
              <span>可用积分</span>
            </div>
            {session.expiresAt && <p className="account-expiry">授权有效期至 {formatDate(session.expiresAt)}</p>}
            <form className="credit-redemption-form" onSubmit={(event) => void redeemCredits(event)}>
              <label htmlFor="credit-redemption-code">额度兑换码</label>
              <div className="credit-redemption-row">
                <div className="account-input-shell">
                  <Ticket />
                  <input
                    id="credit-redemption-code"
                    value={redeemCode}
                    onChange={(event) => {
                      setRedeemCode(event.currentTarget.value.toUpperCase());
                      setError(undefined);
                      setRedeemSuccess(undefined);
                    }}
                    minLength={10}
                    maxLength={64}
                    autoCapitalize="characters"
                    autoComplete="off"
                    placeholder="输入额度兑换码"
                  />
                </div>
                <button type="submit" disabled={busy || redeemCode.trim().length < 10}>
                  {busy ? "兑换中" : "兑换"}
                </button>
              </div>
              {redeemSuccess && <p className="credit-redemption-success" role="status">{redeemSuccess}</p>}
            </form>
            {error && <p className="dialog-error" role="alert">{error}</p>}
            <button className="account-logout-action" type="button" disabled={busy} onClick={() => void logout()}>
              <SignOut />{busy ? "正在退出" : "退出此设备"}
            </button>
          </div>
        ) : challenge ? (
          <form className="account-form" onSubmit={(event) => void verifyCode(event)}>
            <button className="account-back-action" type="button" onClick={() => { setChallenge(undefined); setError(undefined); }}>
              <ArrowLeft /> 更换邮箱
            </button>
            <div className="verification-copy">
              <strong>验证码已发送</strong>
              <span>请查看 {email}，验证码 {Math.round(challenge.expiresIn / 60)} 分钟内有效。</span>
            </div>
            <label>
              <span>6 位验证码</span>
              <input
                className="verification-code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                autoFocus
                required
              />
            </label>
            {error && <p className="dialog-error" role="alert">{error}</p>}
            <button className="account-submit-action" type="submit" disabled={busy || code.length !== 6}>
              {busy ? "正在验证" : "登录并同步额度"}
            </button>
          </form>
        ) : (
          <form className="account-form" onSubmit={(event) => void sendCode(event)}>
            <p className="account-intro">使用 Windows 客户端绑定的同一邮箱登录，项目生图将直接使用同一个账号钱包。</p>
            <label>
              <span>邮箱</span>
              <div className="account-input-shell"><EnvelopeSimple /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} placeholder="name@example.com" required /></div>
            </label>
            <label>
              <span>昵称 <small>仅首次注册需要</small></span>
              <input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} minLength={2} maxLength={32} placeholder="工业设计师" />
            </label>
            {error && <p className="dialog-error" role="alert">{error}</p>}
            <button className="account-submit-action" type="submit" disabled={busy || !email.trim()}>
              {busy ? "正在发送" : "发送邮箱验证码"}
            </button>
            <small className="account-security-note">渠道与 API 密钥只保存在服务端，不会写入移动设备。</small>
          </form>
        )}
        <footer className="account-update-footer">
          <span>Inspiration Drawer Mobile v{appVersion}</span>
          <button type="button" onClick={onCheckUpdate} disabled={checkingUpdate}>
            <ArrowClockwise className={checkingUpdate ? "is-spinning" : ""} />
            {checkingUpdate ? "检查中" : "检查更新"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function formatCredits(value?: string): string {
  if (!value) return "--";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(numeric) : value;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(date);
}

function errorMessage(error: unknown, fallback: string): string {
  const message = typeof error === "string" && error.trim()
    ? error
    : error instanceof Error && error.message.trim()
      ? error.message
      : fallback;
  return message.replace(/^[a-z_]+:\s*/i, "");
}
