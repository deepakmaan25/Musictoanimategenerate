import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Mail, Loader2, CheckCircle, ArrowLeft, RotateCcw,
  Eye, EyeOff, KeyRound, ShieldCheck, AlertCircle,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

const OTP_LENGTH     = 6;
const RESEND_SECONDS = 60;

// ─── Step machine ─────────────────────────────────────────────────────────────
// email → password (returning) or signup (new)
//       → otp (fallback login OR email verification after signup)
//       → set_password (optional, after OTP login for accounts with no password)
//       → success
type Step = 'email' | 'password' | 'signup' | 'otp' | 'set_password' | 'reset_sent' | 'success';
type OtpReason = 'verify_signup' | 'login_fallback';

// ─── Error messages ────────────────────────────────────────────────────────────
function friendlyError(err: any): string {
  const msg = (err?.message ?? '').toLowerCase();

  // Supabase email quota (free tier ~4 emails/hour per project)
  if (msg.includes('email rate limit') || msg.includes('email_rate_limit')) {
    return 'Email sending limit reached (Supabase free tier cap). Wait ~1 hour, or click "Use a code" if you already have an account.';
  }
  // Too many failed password attempts
  if (msg.includes('too many requests') || msg.includes('too many attempts')) {
    return 'Too many login attempts. Wait 60 seconds, then try again — or click "Use a code" to bypass this entirely.';
  }
  // Generic rate-limit (catch-all, must be after specific ones)
  if (msg.includes('rate limit') || msg.includes('rate_limit')) {
    return 'Auth server rate limit hit. Wait a minute and try again, or use "Use a code" instead.';
  }
  if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
    return 'Incorrect password. Use "Use a code" below if you originally signed up via email code and never set a password.';
  }
  if (msg.includes('email not confirmed')) {
    return 'Email not verified yet. Check your inbox for the 6-digit code.';
  }
  if (msg.includes('user not found') || msg.includes('no user found')) {
    return 'No account found for this email. Click "New user? Create account" to register.';
  }
  if (msg.includes('expired') || (msg.includes('invalid') && msg.includes('token'))) {
    return 'That code has expired or is incorrect. Request a new one below.';
  }
  if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
    return 'This email is already registered. Use "Sign in" or "Use a code" instead of creating a new account.';
  }
  if (msg.includes('password') && (msg.includes('short') || msg.includes('weak') || msg.includes('6'))) {
    return 'Password must be at least 6 characters.';
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'Network error. Check your connection and try again.';
  }
  // Show raw Supabase message as fallback so it's debuggable
  return err?.message || 'Something went wrong. Please try again.';
}

// ─── Password field ────────────────────────────────────────────────────────────
function PasswordInput({ value, onChange, placeholder, autoComplete, autoFocus }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; autoComplete?: string; autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 size-4 pointer-events-none"
        style={{ color: 'var(--text-muted)' }} />
      <Input type={show ? 'text' : 'password'} value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Password'}
        autoComplete={autoComplete ?? 'current-password'}
        autoFocus={autoFocus}
        className="pl-9 pr-10 h-11" />
      <button type="button" onClick={() => setShow((s) => !s)} tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 size-5 flex items-center justify-center"
        style={{ color: 'var(--text-muted)' }}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

// ─── OTP digit box ─────────────────────────────────────────────────────────────
interface DigitBoxProps {
  idx: number; value: string; disabled: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (idx: number, val: string) => void;
  onKeyDown: (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
}
function DigitBox({ idx, value, disabled, inputRef, onChange, onKeyDown, onPaste }: DigitBoxProps) {
  return (
    <input ref={inputRef} type="text" inputMode="numeric" pattern="[0-9]*"
      maxLength={OTP_LENGTH} autoComplete={idx === 0 ? 'one-time-code' : 'off'}
      value={value} disabled={disabled}
      onChange={(e) => onChange(idx, e.target.value)}
      onKeyDown={(e) => onKeyDown(idx, e)} onPaste={onPaste}
      onFocus={(e) => e.target.select()} aria-label={`Digit ${idx + 1}`}
      className="size-12 text-center text-lg font-semibold rounded-xl border-2 transition-all outline-none focus:border-purple-500 disabled:opacity-40"
      style={{
        background: 'var(--surface-glass)',
        borderColor: value ? 'rgb(168,85,247)' : 'var(--surface-glass-border)',
        color: 'var(--text-strong)',
      }}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signInWithPassword, signUpWithPassword, sendOtp, verifyOtp, sendPasswordReset, updatePassword } = useAuth();

  const [step, setStep]         = useState<Step>('email');
  const [otpReason, setOtpReason] = useState<OtpReason>('login_fallback');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [newPwd, setNewPwd]     = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // OTP state
  const [digits, setDigits]           = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [verifying, setVerifying]     = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const inputRefs    = useRef<(HTMLInputElement | null)[]>([]);
  const verifyingRef = useRef(false);
  const [cooldown, setCooldown]       = useState(0);
  const cooldownRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset on close
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStep('email'); setEmail(''); setPassword(''); setConfirm(''); setNewPwd('');
        setLoading(false); setError(null);
        setDigits(Array(OTP_LENGTH).fill('')); setVerifying(false); setVerifyError(null);
        verifyingRef.current = false; setCooldown(0);
        if (cooldownRef.current) clearInterval(cooldownRef.current);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  const startCooldown = () => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setCooldown(RESEND_SECONDS);
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => { if (c <= 1) { clearInterval(cooldownRef.current!); return 0; } return c - 1; });
    }, 1000);
  };

  // ── Step: email — detect account existence WITHOUT sending any email ──────
  const handleEmailContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || loading) return;
    setError(null);
    setLoading(true);

    try {
      // Sign in with a deliberately wrong password — this tells us:
      //   "Invalid login credentials" → user EXISTS → show password step
      //   "Email not confirmed"       → user EXISTS → show password step
      //   "User not found" / similar  → user DOESN'T EXIST → show signup
      // No email is sent in any case.
      const { error: checkError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: '\x00__probe__\x00',  // guaranteed wrong, no email sent
      });

      if (checkError) {
        const msg = checkError.message.toLowerCase();
        const userExists =
          msg.includes('invalid login') ||
          msg.includes('invalid credentials') ||
          msg.includes('email not confirmed') ||
          msg.includes('too many');
        setStep(userExists ? 'password' : 'signup');
      } else {
        // Extremely unlikely (would mean the probe password matched)
        setStep('password');
      }
    } catch {
      // Network error or unexpected — default to password step (safe fallback)
      setStep('password');
    } finally {
      setLoading(false);
    }
  };

  // ── Step: sign in with password ─────────────────────────────────────────────
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true); setError(null);
    try {
      await signInWithPassword(email.trim(), password);
      setStep('success');
      setTimeout(onClose, 1400);
    } catch (err: any) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Step: sign up ───────────────────────────────────────────────────────────
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true); setError(null);
    try {
      const result = await signUpWithPassword(email.trim(), password);
      // If email confirmation is OFF in Supabase, session is created immediately
      // If email confirmation is ON, user.identities exists but session is null
      const sessionCreated = !!result.session;
      if (sessionCreated) {
        // Confirmation off — signed in immediately, no OTP needed
        setStep('success');
        setTimeout(onClose, 1400);
      } else {
        // Confirmation on — need to verify email via OTP
        setDigits(Array(OTP_LENGTH).fill(''));
        setVerifyError(null); verifyingRef.current = false;
        setOtpReason('verify_signup');
        startCooldown();
        setStep('otp');
        setTimeout(() => inputRefs.current[0]?.focus(), 320);
      }
    } catch (err: any) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Send OTP (fallback login) ────────────────────────────────────────────────
  const handleSendOtp = async () => {
    setLoading(true); setError(null);
    try {
      await sendOtp(email.trim());
      setDigits(Array(OTP_LENGTH).fill(''));
      setVerifyError(null); verifyingRef.current = false;
      setOtpReason('login_fallback');
      startCooldown();
      setStep('otp');
      setTimeout(() => inputRefs.current[0]?.focus(), 320);
    } catch (err: any) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Verify OTP ──────────────────────────────────────────────────────────────
  const handleVerify = async (code: string) => {
    if (code.length !== OTP_LENGTH || verifyingRef.current) return;
    verifyingRef.current = true; setVerifying(true); setVerifyError(null);
    try {
      await verifyOtp(email, code);
      // After OTP login (not signup verification), offer to set a password
      if (otpReason === 'login_fallback') {
        setNewPwd('');
        setStep('set_password');
      } else {
        setStep('success');
        setTimeout(onClose, 1400);
      }
    } catch (err: any) {
      verifyingRef.current = false; setVerifying(false);
      setVerifyError(friendlyError(err));
      setDigits(Array(OTP_LENGTH).fill(''));
      setTimeout(() => inputRefs.current[0]?.focus(), 60);
    }
  };

  // ── Set password (post-OTP) ─────────────────────────────────────────────────
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true); setError(null);
    try {
      await updatePassword(newPwd);
      setStep('success');
      setTimeout(onClose, 1400);
    } catch (err: any) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot password ─────────────────────────────────────────────────────────
  const handleForgotPassword = async () => {
    setLoading(true); setError(null);
    try {
      await sendPasswordReset(email.trim());
      setStep('reset_sent');
    } catch (err: any) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  // ── OTP digit handlers ──────────────────────────────────────────────────────
  const onDigitChange = (idx: number, raw: string) => {
    const clean = raw.replace(/\D/g, '');
    if (clean.length > 1) {
      const next = Array(OTP_LENGTH).fill('');
      for (let i = 0; i < Math.min(clean.length, OTP_LENGTH); i++) next[i] = clean[i];
      setDigits(next);
      inputRefs.current[Math.min(clean.length, OTP_LENGTH - 1)]?.focus();
      if (clean.length >= OTP_LENGTH) handleVerify(clean.slice(0, OTP_LENGTH));
      return;
    }
    const next = [...digits]; next[idx] = clean; setDigits(next);
    if (clean && idx < OTP_LENGTH - 1) inputRefs.current[idx + 1]?.focus();
    const code = next.join('');
    if (code.length === OTP_LENGTH && next.every(Boolean)) handleVerify(code);
  };
  const onDigitKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) inputRefs.current[idx - 1]?.focus();
    if (e.key === 'ArrowLeft'  && idx > 0)              inputRefs.current[idx - 1]?.focus();
    if (e.key === 'ArrowRight' && idx < OTP_LENGTH - 1) inputRefs.current[idx + 1]?.focus();
  };
  const onDigitPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = Array(OTP_LENGTH).fill('');
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    inputRefs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
    if (pasted.length === OTP_LENGTH) handleVerify(pasted);
  };

  // ── Shared styles ───────────────────────────────────────────────────────────
  const card = {
    background: 'var(--surface-elevated)', borderColor: 'var(--surface-glass-border)',
    color: 'var(--text-strong)', backdropFilter: 'blur(20px)',
  };
  const fwd = { initial: { opacity: 0, x: 16 },  animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -16 }, transition: { duration: 0.18 } };
  const bwd = { initial: { opacity: 0, x: -16 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x:  16 }, transition: { duration: 0.18 } };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={step !== 'success' ? onClose : undefined}>
          <motion.div initial={{ scale: 0.95, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }} transition={{ duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border p-6 overflow-hidden" style={card}>
            <AnimatePresence mode="wait" initial={false}>

              {/* ── Email ──────────────────────────────────────────────── */}
              {step === 'email' && (
                <motion.div key="email" {...bwd}>
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-xl font-semibold tracking-tight">Welcome</h2>
                    <button onClick={onClose} className="size-8 rounded-md hover:bg-black/5 flex items-center justify-center"><X className="size-4" /></button>
                  </div>
                  <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>Enter your email to sign in or create an account.</p>
                  <form onSubmit={handleEmailContinue} className="space-y-3">
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                      <Input type="email" required placeholder="you@example.com" autoComplete="email" autoFocus
                        value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9 h-11" />
                    </div>
                    <Button type="submit" disabled={loading || !email.trim()} className="w-full h-11 text-white" style={{ background: 'var(--hero-cta-gradient)' }}>
                      {loading ? <><Loader2 className="size-4 animate-spin mr-2" />Checking…</> : 'Continue →'}
                    </Button>
                  </form>
                </motion.div>
              )}

              {/* ── Password (sign in) ─────────────────────────────────── */}
              {step === 'password' && (
                <motion.div key="password" {...fwd}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <button onClick={() => { setStep('email'); setError(null); }}
                      className="size-8 rounded-md hover:bg-black/5 flex items-center justify-center shrink-0">
                      <ArrowLeft className="size-4" />
                    </button>
                    <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
                    <button onClick={onClose} className="size-8 rounded-md hover:bg-black/5 flex items-center justify-center ml-auto shrink-0"><X className="size-4" /></button>
                  </div>
                  <p className="text-sm mb-4 pl-9" style={{ color: 'var(--text-muted)' }}>
                    Signing in as <strong style={{ color: 'var(--text-strong)' }}>{email}</strong>
                  </p>

                  <form onSubmit={handleSignIn} className="space-y-3">
                    <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" autoFocus />

                    {/* Error — show after first failure */}
                    {error && (
                      <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs"
                        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                        <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                        <span>{error}</span>
                      </div>
                    )}

                    <Button type="submit" disabled={loading || !password}
                      className="w-full h-11 text-white" style={{ background: 'var(--hero-cta-gradient)' }}>
                      {loading ? <><Loader2 className="size-4 animate-spin mr-2" />Signing in…</> : 'Sign in'}
                    </Button>
                  </form>

                  {/* Bottom links — 10px, all on one line */}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t"
                    style={{ borderColor: 'var(--surface-glass-border)', color: 'var(--text-muted)' }}>
                    <button onClick={() => { setStep('signup'); setPassword(''); setConfirm(''); setError(null); }}
                      className="text-[10px] hover:underline whitespace-nowrap">New user? Create account</button>
                    <div className="flex items-center gap-2">
                      <button onClick={handleForgotPassword} disabled={loading}
                        className="text-[10px] hover:underline disabled:opacity-40 whitespace-nowrap">Forgot password?</button>
                      <span className="text-[10px]" style={{ color: 'var(--surface-glass-border)' }}>·</span>
                      <button onClick={handleSendOtp} disabled={loading}
                        className="text-[10px] hover:underline disabled:opacity-40 whitespace-nowrap">Use a code</button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ── Sign up ────────────────────────────────────────────── */}
              {step === 'signup' && (
                <motion.div key="signup" {...fwd}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <button onClick={() => { setStep('email'); setError(null); }}
                      className="size-8 rounded-md hover:bg-black/5 flex items-center justify-center shrink-0">
                      <ArrowLeft className="size-4" />
                    </button>
                    <h2 className="text-xl font-semibold tracking-tight">Create account</h2>
                    <button onClick={onClose} className="size-8 rounded-md hover:bg-black/5 flex items-center justify-center ml-auto shrink-0"><X className="size-4" /></button>
                  </div>
                  <p className="text-sm mb-5 pl-9" style={{ color: 'var(--text-muted)' }}>
                    Account for <strong style={{ color: 'var(--text-strong)' }}>{email}</strong>
                  </p>
                  <form onSubmit={handleSignUp} className="space-y-3">
                    <div>
                      <PasswordInput value={password} onChange={setPassword} placeholder="Create a password (min 6 chars)" autoComplete="new-password" autoFocus />
                      {password.length > 0 && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="flex gap-1 flex-1">
                            {[1,2,3].map(n => (
                              <div key={n} className="h-1 flex-1 rounded-full transition-all" style={{
                                background: password.length >= n * 4
                                  ? n === 1 ? '#ef4444' : n === 2 ? '#f59e0b' : '#10b981'
                                  : 'rgba(255,255,255,0.08)'
                              }} />
                            ))}
                          </div>
                          <span className="text-[10px]" style={{ color: password.length < 4 ? '#ef4444' : password.length < 8 ? '#f59e0b' : '#10b981' }}>
                            {password.length < 4 ? 'Weak' : password.length < 8 ? 'Fair' : 'Strong'}
                          </span>
                        </div>
                      )}
                    </div>
                    <PasswordInput value={confirm}  onChange={setConfirm}  placeholder="Confirm password" autoComplete="new-password" />
                    {error && (
                      <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs"
                        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                        <AlertCircle className="size-3.5 shrink-0 mt-0.5" /><span>{error}</span>
                      </div>
                    )}
                    <Button type="submit" disabled={loading || !password || !confirm}
                      className="w-full h-11 text-white" style={{ background: 'var(--hero-cta-gradient)' }}>
                      {loading ? <><Loader2 className="size-4 animate-spin mr-2" />Creating account…</> : 'Create account'}
                    </Button>
                  </form>
                  <p className="text-xs text-center mt-3" style={{ color: 'var(--text-muted)' }}>
                    We'll email you a code to verify your address.
                  </p>
                </motion.div>
              )}

              {/* ── OTP entry ─────────────────────────────────────────── */}
              {step === 'otp' && (
                <motion.div key="otp" {...fwd}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <button onClick={() => { setStep('password'); setError(null); }}
                      className="size-8 rounded-md hover:bg-black/5 flex items-center justify-center shrink-0">
                      <ArrowLeft className="size-4" />
                    </button>
                    <h2 className="text-xl font-semibold tracking-tight">Check your inbox</h2>
                    <button onClick={onClose} className="size-8 rounded-md hover:bg-black/5 flex items-center justify-center ml-auto shrink-0"><X className="size-4" /></button>
                  </div>
                  <p className="text-sm mb-6 pl-9" style={{ color: 'var(--text-muted)' }}>
                    We sent a 6-digit code to <strong style={{ color: 'var(--text-strong)' }}>{email}</strong>.
                  </p>
                  <div className="flex gap-2 justify-center mb-3">
                    {digits.map((d, i) => (
                      <DigitBox key={i} idx={i} value={d} disabled={verifying}
                        inputRef={(el) => { inputRefs.current[i] = el; }}
                        onChange={onDigitChange} onKeyDown={onDigitKeyDown} onPaste={onDigitPaste} />
                    ))}
                  </div>
                  <div className="min-h-[28px] flex items-center justify-center mb-2">
                    <AnimatePresence mode="wait">
                      {verifying && (
                        <motion.div key="v" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
                          <Loader2 className="size-3.5 animate-spin" /> Verifying…
                        </motion.div>
                      )}
                      {verifyError && (
                        <motion.p key="e" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                          className="text-xs text-red-400 text-center px-2">{verifyError}</motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="flex items-center justify-center gap-4 pt-1">
                    <button disabled={cooldown > 0 || loading} onClick={async () => {
                      if (cooldown > 0 || loading) return;
                      setLoading(true);
                      try { await sendOtp(email); startCooldown(); setDigits(Array(OTP_LENGTH).fill('')); setVerifyError(null); verifyingRef.current = false; }
                      catch {} finally { setLoading(false); }
                    }} className="flex items-center gap-1.5 text-xs disabled:opacity-40" style={{ color: 'var(--text-muted)' }}>
                      {loading ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                      {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                    </button>
                    <span style={{ color: 'var(--surface-glass-border)' }}>·</span>
                    <button onClick={() => setStep('email')} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Use different email
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ── Set password (after OTP login) ────────────────────── */}
              {step === 'set_password' && (
                <motion.div key="set_password" {...fwd}>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xl font-semibold tracking-tight">Set a password</h2>
                    <button onClick={() => { setStep('success'); setTimeout(onClose, 1400); }}
                      className="size-8 rounded-md hover:bg-black/5 flex items-center justify-center"><X className="size-4" /></button>
                  </div>
                  <div className="rounded-lg px-3 py-2.5 mb-4 text-xs"
                    style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: 'rgb(52,211,153)' }}>
                    ✓ Signed in successfully! Set a password so you can log in with email + password next time.
                  </div>
                  <form onSubmit={handleSetPassword} className="space-y-3">
                    <PasswordInput value={newPwd} onChange={setNewPwd} placeholder="New password (min 6 chars)"
                      autoComplete="new-password" autoFocus />
                    {error && (
                      <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs"
                        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                        <AlertCircle className="size-3.5 shrink-0 mt-0.5" /><span>{error}</span>
                      </div>
                    )}
                    <Button type="submit" disabled={loading || newPwd.length < 6}
                      className="w-full h-11 text-white" style={{ background: 'var(--hero-cta-gradient)' }}>
                      {loading ? <><Loader2 className="size-4 animate-spin mr-2" />Saving…</> : 'Save password'}
                    </Button>
                    <button type="button" onClick={() => { setStep('success'); setTimeout(onClose, 1400); }}
                      className="w-full text-xs text-center pt-1 hover:underline" style={{ color: 'var(--text-muted)' }}>
                      Skip for now
                    </button>
                  </form>
                </motion.div>
              )}

              {/* ── Password reset sent ───────────────────────────────── */}
              {step === 'reset_sent' && (
                <motion.div key="reset" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-4 text-center">
                  <div className="size-14 rounded-full flex items-center justify-center mx-auto mb-4"
                    style={{ background: 'rgba(168,85,247,0.12)' }}>
                    <Mail className="size-7 text-purple-400" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2">Check your inbox</h2>
                  <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                    We sent a password reset link to <strong>{email}</strong>.
                  </p>
                  <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                    Click the link in the email to set your password, then come back to sign in.
                  </p>
                  <button onClick={() => { setStep('password'); setError(null); }}
                    className="text-xs hover:underline" style={{ color: 'var(--text-muted)' }}>
                    ← Back to sign in
                  </button>
                </motion.div>
              )}

              {/* ── Success ───────────────────────────────────────────── */}
              {step === 'success' && (
                <motion.div key="success" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="py-6 text-center">
                  <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.08 }}
                    className="flex justify-center mb-4">
                    <div className="size-16 rounded-full flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.12)' }}>
                      <CheckCircle className="size-8 text-emerald-500" />
                    </div>
                  </motion.div>
                  <motion.h2 initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
                    className="text-xl font-semibold mb-1">You're in!</motion.h2>
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.26 }}
                    className="text-sm" style={{ color: 'var(--text-muted)' }}>Your projects are now syncing.</motion.p>
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
                    className="flex items-center justify-center gap-1.5 mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <ShieldCheck className="size-3.5 text-emerald-500" /> Secured with Supabase Auth
                  </motion.div>
                </motion.div>
              )}

            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
