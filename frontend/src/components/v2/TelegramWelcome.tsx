'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface TelegramUser {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
    photo_url?: string;
}

interface TelegramWelcomeProps {
    onComplete: (userData: any) => void;
}

export const TelegramWelcome: React.FC<TelegramWelcomeProps> = ({ onComplete }) => {
    const [tgUser, setTgUser] = useState<TelegramUser | null>(null);
    const [step, setStep] = useState<'welcome' | 'loading' | 'error'>('welcome');
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        // Get Telegram user data from SDK
        const tg = (window as any).Telegram?.WebApp;
        if (tg) {
            tg.ready();
            tg.expand();
            const user = tg.initDataUnsafe?.user;
            if (user) {
                setTgUser(user);
                // If cached account belongs to a different Telegram user, clear it
                try {
                    const cached = localStorage.getItem('arc_user');
                    if (cached) {
                        const cachedUser = JSON.parse(cached);
                        if (cachedUser.telegramId && cachedUser.telegramId !== user.id.toString()) {
                            console.log('[TelegramWelcome] Different Telegram account detected, clearing cache');
                            localStorage.removeItem('arc_user');
                            localStorage.removeItem('arc_session_token');
                            localStorage.removeItem('arc_encryption_key');
                            localStorage.removeItem('arc_wallet_address');
                        }
                    }
                } catch (e) {}
            }
        }
    }, []);

    const handleGetStarted = async () => {
        if (!tgUser) {
            setErrorMsg('Could not read Telegram user data. Please restart the app.');
            setStep('error');
            return;
        }

        setStep('loading');

        try {
            const tg = (window as any).Telegram?.WebApp;
            const initData = tg?.initData || '';

            const res = await fetch('/api/auth/telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegramId: tgUser.id.toString(),
                    telegramUsername: tgUser.username || `user_${tgUser.id}`,
                    telegramName: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' '),
                    initData,
                }),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Authentication failed');
            }

            // Save session to localStorage (same pattern as email login)
            localStorage.setItem('arc_user', JSON.stringify({ 
    ...data.user, 
    telegramId: tgUser.id.toString() 
}));
            if (data.circleSession?.userToken) {
                localStorage.setItem('arc_session_token', data.circleSession.userToken);
            }
            if (data.circleSession?.encryptionKey) {
                localStorage.setItem('arc_encryption_key', data.circleSession.encryptionKey);
            }
            if (data.walletAddress) {
                localStorage.setItem('arc_wallet_address', data.walletAddress);
            }

            onComplete(data.user);

        } catch (e: any) {
            console.error('[TelegramWelcome] Auth error:', e);
            setErrorMsg(e.message || 'Something went wrong. Please try again.');
            setStep('error');
        }
    };

    const displayName = tgUser
        ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || 'there'
        : 'there';

    return (
        <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-between px-6 py-12 relative overflow-hidden">

            {/* Background glow effects */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-blue-600/10 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-indigo-600/10 blur-[100px] pointer-events-none" />

            {/* Top logo */}
            <div className="flex flex-col items-center gap-3 z-10 mt-8">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                        <path d="M6 24L16 8L26 24H6Z" fill="white" fillOpacity="0.9" />
                        <path d="M11 24L16 15L21 24H11Z" fill="white" fillOpacity="0.4" />
                    </svg>
                </div>
                <span className="text-white/40 text-xs font-mono tracking-widest uppercase">ArcWorker</span>
            </div>

            {/* Main content */}
            <div className="flex flex-col items-center gap-8 z-10 w-full max-w-sm">
                {step === 'welcome' && (
                    <>
                        <div className="text-center space-y-3">
                            <h1 className="text-3xl font-bold text-white leading-tight">
                                Hey, {displayName} 👋
                            </h1>
                            <p className="text-white/50 text-base leading-relaxed">
                                Complete micro-tasks and earn <span className="text-blue-400 font-semibold">USDC</span> instantly — paid to your wallet the moment your work is verified.
                            </p>
                        </div>

                        {/* Feature pills */}
                        <div className="flex flex-wrap gap-2 justify-center">
                            {['Instant USDC pay', 'AI-powered tasks', 'No KYC needed', 'Withdraw anytime'].map((f) => (
                                <span key={f} className="px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-white/60 text-xs font-medium">
                                    {f}
                                </span>
                            ))}
                        </div>

                        {/* Stats row */}
                        <div className="grid grid-cols-3 gap-3 w-full">
                            {[
                                { label: 'Avg. Reward', value: '$0.15' },
                                { label: 'Task Time', value: '~2 min' },
                                { label: 'Payout', value: 'Instant' },
                            ].map((s) => (
                                <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-3 text-center">
                                    <p className="text-white font-bold text-lg">{s.value}</p>
                                    <p className="text-white/40 text-[11px] mt-0.5">{s.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* CTA Button */}
                        <button
                            onClick={handleGetStarted}
                            className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold text-base shadow-lg shadow-blue-500/30 active:scale-95 transition-transform"
                        >
                            Get Started →
                        </button>

                        <p className="text-white/20 text-xs text-center">
                            By continuing, you agree to ArcWorker's terms. A Circle wallet will be created for you automatically.
                        </p>
                    </>
                )}

                {step === 'loading' && (
                    <div className="flex flex-col items-center gap-6 py-12">
                        <div className="w-16 h-16 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" />
                        <div className="text-center space-y-2">
                            <p className="text-white font-semibold">Setting up your account...</p>
                            <p className="text-white/40 text-sm">Creating your Circle wallet</p>
                        </div>
                    </div>
                )}

                {step === 'error' && (
                    <div className="flex flex-col items-center gap-6 py-8 text-center">
                        <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                            <span className="text-2xl">⚠️</span>
                        </div>
                        <div className="space-y-2">
                            <p className="text-white font-semibold">Something went wrong</p>
                            <p className="text-white/40 text-sm">{errorMsg}</p>
                        </div>
                        <button
                            onClick={() => setStep('welcome')}
                            className="px-6 py-3 rounded-xl bg-white/10 text-white text-sm font-medium"
                        >
                            Try Again
                        </button>
                    </div>
                )}
            </div>

            {/* Bottom spacer */}
            <div className="h-4 z-10" />
        </div>
    );
};
