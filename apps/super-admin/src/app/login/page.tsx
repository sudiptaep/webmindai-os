'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { loginSuperAdmin, verifyMfa } from '@/lib/auth';
import { useAuthStore } from '@/store/auth.store';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // MFA step
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await loginSuperAdmin(email, password);
      if ('requires_mfa' in result) {
        setMfaToken(result.mfa_session_token);
      } else {
        setAuth(result.token, result.user as Parameters<typeof setAuth>[1]);
        router.replace('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError('');
    setLoading(true);
    try {
      const { token, user } = await verifyMfa(mfaToken, totpCode);
      setAuth(token, user as Parameters<typeof setAuth>[1]);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl mb-2">🧠</div>
          <h1 className="text-xl font-bold text-white">EduMind AI</h1>
          <p className="text-sm text-gray-400 mt-1">Super Admin Console</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-2xl">
          {!mfaToken ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs mb-1.5 text-gray-400 uppercase tracking-wide">Work email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="sudipta@edumindai.com"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                  required
                />
              </div>
              <div>
                <label className="block text-xs mb-1.5 text-gray-400 uppercase tracking-wide">Password</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 pr-10 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
                  >
                    {showPass ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              {error && (
                <p className="text-red-400 text-xs bg-red-950/30 border border-red-900 rounded px-3 py-2">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white transition-colors"
              >
                {loading ? 'Signing in…' : 'Sign in to console →'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleMfa} className="space-y-4">
              <div className="text-center mb-2">
                <div className="text-2xl mb-1">🔐</div>
                <p className="text-sm text-gray-300">Enter your authenticator code</p>
              </div>
              <div>
                <label className="block text-xs mb-1.5 text-gray-400 uppercase tracking-wide">6-digit code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white text-center tracking-[0.4em] font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                  required
                />
              </div>
              {error && (
                <p className="text-red-400 text-xs bg-red-950/30 border border-red-900 rounded px-3 py-2">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading || totpCode.length !== 6}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white transition-colors"
              >
                {loading ? 'Verifying…' : 'Verify →'}
              </button>
              <button
                type="button"
                onClick={() => { setMfaToken(null); setError(''); setTotpCode(''); }}
                className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                ← Back to login
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-4">
          🔒 Secured · Internal use only · v2.0
        </p>
        <p className="text-center text-xs text-gray-700 mt-1">
          Password reset: contact your system administrator
        </p>
      </div>
    </div>
  );
}
