'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useBalance, useSendTransaction, useConnect, usePublicClient } from 'wagmi';
import { CONTRACTS } from '@/utils/contracts';
import { parseEther, formatUnits } from 'viem';
import { useArcWorkerWallet } from '@/arcworker-sdk/wallet';
import axios from 'axios';
import { Eye, EyeOff, Copy } from 'lucide-react';

interface WalletDashboardModalProps {
    isOpen: boolean;
    onClose: () => void;
    externalSavingsBalance?: string;
}

// Helper to check if user is using any Circle wallet type
const isCircleWallet = (walletType: string) => walletType === 'circle' || walletType === 'dev_circle';

export default function WalletDashboardModal({ isOpen, onClose, externalSavingsBalance }: WalletDashboardModalProps) {
    const { address: wagmiAddress, isConnected: wagmiConnected, status } = useAccount();
    const { connectors, connect } = useConnect();
    const publicClient = usePublicClient();
    const { getBalance: getCircleBalance, sendTransfer: sendCircleTransfer, setupArcWorkerWallet, isLoading: isCircleLoading, error: circleError } = useArcWorkerWallet();

    const [activeTab, setActiveTab] = useState<'ASSETS' | 'SEND' | 'RECEIVE' | 'ACTIVITY'>('ASSETS');
    const [recipient, setRecipient] = useState('');
    const [amount, setAmount] = useState('');
    const [memo, setMemo] = useState('');
    const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
    const [socialMemos, setSocialMemos] = useState<any[]>([]);
    const [isMemosLoading, setIsMemosLoading] = useState(false);

    const [isCircle, setIsCircle] = useState(() => {
        if (typeof window === 'undefined') return false;
        const savedUser = localStorage.getItem('arc_user');
        const sessionToken = localStorage.getItem('arc_session_token');
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                // dev_circle users don't need a session token
                if (user.walletType === 'dev_circle') return true;
                // regular circle users need a session token
                if (sessionToken && user.walletType === 'circle') return true;
            } catch (e) { return false; }
        }
        return false;
    });

    const [circleAddress, setCircleAddress] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        const savedUser = localStorage.getItem('arc_user');
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                return user.walletAddress || user.address || null;
            } catch (e) { return null; }
        }
        return null;
    });

    const [circleBalance, setCircleBalance] = useState<string>('0.00');
    const [isCircleBalanceLoading, setIsCircleBalanceLoading] = useState(false);
    const [isCircleSending, setIsCircleSending] = useState(false);
    const [isCircleSuccess, setIsCircleSuccess] = useState(false);

    const [savingsAssets, setSavingsAssets] = useState<string>('0.00');
    const [isWithdrawing, setIsWithdrawing] = useState(false);
    const [showAddress, setShowAddress] = useState(false);

    const address = isCircle ? circleAddress : wagmiAddress;
    const isConnected = isCircle ? !!circleAddress : wagmiConnected;

    const [isWorker, setIsWorker] = useState(false);
    useEffect(() => {
        const savedUser = localStorage.getItem('arc_user');
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                setIsWorker(user.role === 'worker');
            } catch (e) { }
        }
    }, []);

    const devCircleAddress = isCircle && circleAddress ? circleAddress as `0x${string}` : undefined;

const { data: wagmiBalanceData, isLoading: isWagmiBalanceLoading, refetch: refetchWagmiBalance } = useBalance({
    address: devCircleAddress || wagmiAddress,
    query: { enabled: !!devCircleAddress || (!isCircle && !!wagmiAddress) }
});

    const { sendTransaction: wagmiSend, data: hash, isPending: isWagmiPending, error: wagmiSendError, reset: resetWagmiSend } = useSendTransaction();
    const { isLoading: isWagmiConfirming, isSuccess: isWagmiSuccess } = useWaitForTransactionReceipt({ hash });

    const [isManualRegistering, setIsManualRegistering] = useState(false);
    const { writeContract: writeUserRegistry, data: regHash } = useWriteContract();
    const { isLoading: isWagmiRegistering, isSuccess: isRegSuccess } = useWaitForTransactionReceipt({ hash: regHash });
    const isRegisteringOnChain = isManualRegistering || isWagmiRegistering;

    const { data: currentAddressName } = useReadContract({
        address: CONTRACTS.UserRegistry.address,
        abi: CONTRACTS.UserRegistry.abi,
        functionName: 'getName',
        args: [address as `0x${string}`],
        query: { enabled: !!address }
    });

    const { data: nameResolution, isLoading: isResolvingName } = useReadContract({
        address: CONTRACTS.UserRegistry.address,
        abi: CONTRACTS.UserRegistry.abi,
        functionName: 'resolve',
        args: [recipient.replace('@', '').toLowerCase()],
        query: {
            enabled: recipient.startsWith('@') && recipient.length > 3
        }
    });

    useEffect(() => {
        if (recipient.startsWith('@')) {
            if (nameResolution && nameResolution !== '0x0000000000000000000000000000000000000000') {
                setResolvedAddress(nameResolution as string);
            } else {
                setResolvedAddress(null);
            }
        } else {
            setResolvedAddress(null);
        }
    }, [recipient, nameResolution]);

    const uniqueMemoAddresses = useMemo(() => {
        const addrs = new Set<string>();
        socialMemos.forEach(m => {
            if (m.fromAddress) addrs.add(m.fromAddress.toLowerCase());
            if (m.toAddress) addrs.add(m.toAddress.toLowerCase());
        });
        return Array.from(addrs);
    }, [socialMemos]);

    const [contacts, setContacts] = useState<any[]>([]);

    useEffect(() => {
        const stored = localStorage.getItem('arc_contacts');
        if (stored) setContacts(JSON.parse(stored));
    }, [isOpen]);

    const addToContacts = (addr: string, name?: string) => {
        const stored = localStorage.getItem('arc_contacts');
        let list = stored ? JSON.parse(stored) : [];
        list = list.filter((c: any) => c.address.toLowerCase() !== addr.toLowerCase());
        list.unshift({ address: addr, name: name || '', lastUsed: Date.now() });
        list = list.slice(0, 5);
        localStorage.setItem('arc_contacts', JSON.stringify(list));
        setContacts(list);
    };

    const { data: resolvedMemoNames } = useReadContracts({
        contracts: uniqueMemoAddresses.map((addr: string) => ({
            address: CONTRACTS.UserRegistry.address,
            abi: CONTRACTS.UserRegistry.abi,
            functionName: 'getName',
            args: [addr as `0x${string}`],
        })),
        query: {
            enabled: uniqueMemoAddresses.length > 0
        }
    });

    const socialNameMap = useMemo(() => {
        const map: Record<string, string> = {};
        if (resolvedMemoNames) {
            uniqueMemoAddresses.forEach((addr: string, i: number) => {
                const name = resolvedMemoNames[i]?.result as string;
                if (name && name.length > 0) {
                    map[addr.toLowerCase()] = name;
                }
            });
        }
        return map;
    }, [uniqueMemoAddresses, resolvedMemoNames]);

    useEffect(() => {
        const checkSession = () => {
            const savedUser = localStorage.getItem('arc_user');
            const sessionToken = localStorage.getItem('arc_session_token');
            if (savedUser) {
                try {
                    const user = JSON.parse(savedUser);
                    if (user.walletType === 'dev_circle') {
                        setIsCircle(true);
                        setCircleAddress(user.walletAddress || user.address || null);
                    } else if (sessionToken && user.walletType === 'circle') {
                        setIsCircle(true);
                        setCircleAddress(user.address || null);
                    } else {
                        setIsCircle(false);
                    }
                } catch (e) {
                    setIsCircle(false);
                    setCircleAddress(null);
                }
            } else {
                setIsCircle(false);
                setCircleAddress(null);
            }
        };

        if (isOpen) {
            checkSession();
        }
    }, [isOpen]);

    const fetchCircleBalance = React.useCallback(async () => {
        if (!isCircle || !isOpen) return;

        // For dev_circle wallets, fetch balance directly from address
        const savedUser = localStorage.getItem('arc_user');
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                if (user.walletType === 'dev_circle') {
                    // Use wallet address directly - no session token needed
                    const walletAddr = user.walletAddress || user.address;
                    if (walletAddr) {
                        setCircleAddress(walletAddr);
                        // Balance will be read via on-chain hook (wagmi useBalance)
                        // For now show 0 - on-chain balance hooks handle this
                    }
                    return;
                }
            } catch (e) { }
        }

        setIsCircleBalanceLoading(true);
        try {
            const data = await getCircleBalance();
            if (data) {
                if (data.balances && data.balances.length > 0) {
                    setCircleBalance(data.balances[0].amount);
                }
                if (data.address && !circleAddress) {
                    setCircleAddress(data.address);
                    const savedUser = localStorage.getItem('arc_user');
                    if (savedUser) {
                        try {
                            const user = JSON.parse(savedUser);
                            user.address = data.address;
                            localStorage.setItem('arc_user', JSON.stringify(user));
                        } catch (e) { }
                    }
                }
            }
        } catch (err: any) {
            console.error("Failed to fetch Circle balance:", err);
            if (err.message === "SESSION_EXPIRED") {
                const savedUser = localStorage.getItem('arc_user');
                if (savedUser) {
                    try {
                        const user = JSON.parse(savedUser);
                        if (user.username) {
                            await setupArcWorkerWallet(user.username, 'worker', 'circle', { skipCreation: true });
                            const retryData = await getCircleBalance();
                            if (retryData?.balances?.[0]) {
                                setCircleBalance(retryData.balances[0].amount);
                            }
                        }
                    } catch (reAuthErr) {
                        console.error("[WalletModal] Auto-refresh failed:", reAuthErr);
                    }
                }
            }
        } finally {
            setIsCircleBalanceLoading(false);
        }
    }, [isCircle, isOpen, getCircleBalance, circleAddress]);

    useEffect(() => {
        if (isOpen && isCircle) {
            fetchCircleBalance();
        }
    }, [isOpen, isCircle, fetchCircleBalance]);

    const { data: rawSavingsShares, refetch: refetchSavings } = useReadContract({
        address: CONTRACTS.TaskEscrow.address,
        abi: CONTRACTS.TaskEscrow.abi,
        functionName: 'savingsShares',
        args: [address as `0x${string}`],
        query: { enabled: !!address }
    });

    const { data: rawSavingsAssets } = useReadContract({
        address: CONTRACTS.MockYieldVault.address,
        abi: CONTRACTS.MockYieldVault.abi,
        functionName: 'convertToAssets',
        args: [rawSavingsShares || BigInt(0)],
        query: { enabled: !!rawSavingsShares }
    });

    useEffect(() => {
        if (externalSavingsBalance) {
            setSavingsAssets(externalSavingsBalance);
        } else if (rawSavingsAssets) {
            setSavingsAssets(formatUnits(rawSavingsAssets as bigint, 18));
        } else {
            setSavingsAssets('0.00');
        }
    }, [rawSavingsAssets, externalSavingsBalance]);

    const { writeContract: writeWithdraw, data: withdrawHash } = useWriteContract();
    const { isLoading: isWithdrawConfirming, isSuccess: isWithdrawSuccess } = useWaitForTransactionReceipt({ hash: withdrawHash });

    useEffect(() => {
        if (isWithdrawSuccess) {
            alert("Withdrawal successful! Funds added to your wallet.");
            refetchSavings();
            if (isCircle) fetchCircleBalance();
            else refetchWagmiBalance();
            setIsWithdrawing(false);
        }
    }, [isWithdrawSuccess, refetchSavings, fetchCircleBalance, refetchWagmiBalance, isCircle]);

    const fetchSocialMemos = React.useCallback(async () => {
        if (!address) return;
        setIsMemosLoading(true);
        try {
            const res = await axios.get(`/api/circle/memos?address=${address}`);
            setSocialMemos(res.data.memos || []);
        } catch (err) {
            console.error("Failed to fetch memos:", err);
        } finally {
            setIsMemosLoading(false);
        }
    }, [address]);

    useEffect(() => {
        if (isOpen && activeTab === 'ACTIVITY') {
            fetchSocialMemos();
        }
    }, [isOpen, activeTab, fetchSocialMemos]);

    useEffect(() => {
        if (!isOpen) {
            const timer = setTimeout(() => {
                setActiveTab('ASSETS');
                setRecipient('');
                setAmount('');
                setMemo('');
                setResolvedAddress(null);
                resetWagmiSend();
                setIsCircleSuccess(false);
                setIsCircleSending(false);
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isOpen, resetWagmiSend]);

    const handleDoSend = async () => {
        if (!isConnected) return;
        const target = resolvedAddress || recipient;
        if (!target || !amount) return;

        if (isCircle) {
            setIsCircleSending(true);
            try {
                await sendCircleTransfer(target, amount, 'USDC', memo);
                setIsCircleSuccess(true);
                addToContacts(target, recipient.startsWith('@') ? recipient.substring(1) : undefined);
                fetchCircleBalance();
                setMemo('');
            } catch (err) {
                console.error("Circle Send Error:", err);
            } finally {
                setIsCircleSending(false);
            }
        } else {
            try {
                wagmiSend({ to: target as `0x${string}`, value: parseEther(amount) });
                if (memo) {
                    await axios.post('/api/social/payment', {
                        fromAddress: address,
                        toAddress: target,
                        amount: amount,
                        symbol: 'ETH',
                        memo: memo
                    });
                }
                addToContacts(target, recipient.startsWith('@') ? recipient.substring(1) : undefined);
                setMemo('');
            } catch (err) {
                console.error("Manual Send Error Catch:", err);
            }
        }
    };

    const handleRegisterOnChain = async (targetName?: string) => {
        const savedUser = localStorage.getItem('arc_user');
        if (!savedUser) return;
        const user = JSON.parse(savedUser);
        const username = (targetName || user.username || user.name).toLowerCase();

        if (isCircle) {
            try {
                if (publicClient) {
                    setIsManualRegistering(true);
                    try {
                        const owner = await publicClient.readContract({
                            address: CONTRACTS.UserRegistry.address,
                            abi: CONTRACTS.UserRegistry.abi,
                            functionName: 'resolve',
                            args: [username]
                        }) as string;

                        if (owner !== "0x0000000000000000000000000000000000000000") {
                            setIsManualRegistering(false);
                            if (address && owner.toLowerCase() === address.toLowerCase()) {
                                alert("Already registered! Refreshing...");
                                window.location.reload();
                                return;
                            }
                            alert(`@${username} is already taken. Try a different name.`);
                            return;
                        }

                        const existingName = await publicClient.readContract({
                            address: CONTRACTS.UserRegistry.address,
                            abi: CONTRACTS.UserRegistry.abi,
                            functionName: 'getName',
                            args: [address as `0x${string}`]
                        }) as string;

                        if (existingName && existingName.length > 0) {
                            setIsManualRegistering(false);
                            alert(`Your wallet is already registered as @${existingName}.`);
                            window.location.reload();
                            return;
                        }
                    } catch (readErr) {
                        console.warn("Pre-check failed, proceeding...", readErr);
                    }
                }

                // Dev Circle (Telegram) wallets — server-side registration, no SDK needed
                if (user.walletType === 'dev_circle') {
                    const walletAddr = user.walletAddress || user.address;
                    const { data } = await axios.post('/api/circle/contract/register-name', {
                        username,
                        walletAddress: walletAddr,
                        isDev: true,
                    });
                    if (data.success) {
                        alert(`✅ @${username} registered! Transaction submitted on-chain.`);
                        setTimeout(() => { window.location.reload(); }, 3000);
                    } else {
                        throw new Error(data.error || 'Registration failed');
                    }
                    setIsManualRegistering(false);
                    return;
                }

                const sessionToken = localStorage.getItem('arc_session_token');
                const { data } = await axios.post('/api/circle/contract/register-name', {
                    userToken: sessionToken,
                    username: username
                });
                if (data.challengeId) {
                    const encryptionKey = localStorage.getItem('arc_encryption_key');
                    await setupArcWorkerWallet(username, 'worker', 'circle', {
                        skipCreation: true,
                        challengeId: data.challengeId,
                        userToken: sessionToken!,
                        encryptionKey: encryptionKey || undefined
                    });
                    alert("Registration initiated! Transaction is processing.");
                    setIsCircleSuccess(true);
                    setTimeout(() => { window.location.reload(); }, 3000);
                }
            } catch (err: any) {
                setIsManualRegistering(false);
                console.error("Circle Register Error:", err);
                alert("Registration error: " + (err.response?.data?.details?.message || err.message));
            }
        } else {
            setIsManualRegistering(true);
            if (publicClient) {
                try {
                    const owner = await publicClient.readContract({
                        address: CONTRACTS.UserRegistry.address,
                        abi: CONTRACTS.UserRegistry.abi,
                        functionName: 'resolve',
                        args: [username]
                    }) as string;

                    if (owner !== "0x0000000000000000000000000000000000000000") {
                        setIsManualRegistering(false);
                        if (address && owner.toLowerCase() === address.toLowerCase()) {
                            alert("Already registered!");
                            window.location.reload();
                            return;
                        }
                        alert(`@${username} is already taken.`);
                        return;
                    }
                } catch (e) {
                    console.warn("Pre-check failed", e);
                }
            }

            writeUserRegistry({
                address: CONTRACTS.UserRegistry.address,
                abi: CONTRACTS.UserRegistry.abi,
                functionName: 'register',
                args: [username],
            });
        }
    };

    const isPending = isCircle ? isCircleSending : isWagmiPending;
    const isConfirming = isCircle ? false : isWagmiConfirming;
    const isSuccess = isCircle ? isCircleSuccess : isWagmiSuccess;
    const sendError = isCircle ? circleError : wagmiSendError;

    const formattedWagmiBalance = wagmiBalanceData
        ? formatUnits(wagmiBalanceData.value, wagmiBalanceData.decimals)
        : '0.00';

    const liquidBalance = Number(formattedWagmiBalance);
    const savingsBalance = Number(savingsAssets);
    const totalBalance = liquidBalance + savingsBalance;
    const balanceDisplay = totalBalance.toFixed(2);
    const liquidDisplay = liquidBalance.toFixed(2);

    const isAddressValid = resolvedAddress || (recipient.startsWith('0x') && recipient.length === 42);
    const isConnectorError = typeof sendError !== 'string' && (sendError as any)?.message?.includes('Connector not connected');

    if (!isOpen) return null;

    if (!isConnected || !address) {
        return (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
                <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-8 text-center relative">
                    <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-slate-100 text-slate-500 rounded-full hover:bg-slate-200 transition-colors">✕</button>
                    <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
                        {isCircle ? '⌛' : '⚡'}
                    </div>
                    <h3 className="font-bold text-slate-900 text-lg mb-2">
                        {isCircle ? 'Loading Wallet...' : 'Wallet Disconnected'}
                    </h3>
                    <p className="text-slate-500 text-sm mb-6">
                        {isCircle ? 'Please wait while we sync your protocol wallet.' : 'Please connect your wallet to access funds.'}
                    </p>
                    {!isCircle ? (
                        <button onClick={() => connect({ connector: connectors[0] })} className="w-full py-3 bg-[#005ddb] text-white font-bold rounded-xl hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20">
                            Connect Wallet
                        </button>
                    ) : (
                        <div className="w-full py-2 flex items-center justify-center space-x-2 text-blue-600 font-bold">
                            <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></span>
                            <span>Syncing session...</span>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
            <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl relative min-h-[500px] flex flex-col transform transition-all">
                <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-slate-800 text-lg">My Wallet</h3>
                        <div className="flex flex-col mt-1">
                            {currentAddressName && (
                                <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">@{currentAddressName as string}</p>
                            )}
                            <div className="flex items-center gap-2">
                                <div
                                    className="inline-flex items-center gap-3 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-200 transition select-none min-w-[160px] justify-between group/address"
                                    onClick={() => setShowAddress(!showAddress)}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-mono text-slate-600 tracking-tight font-bold">
                                            {showAddress ? (address ? `${address.substring(0, 6)}...${address.substring(38)}` : '0x...') : '****...****'}
                                        </span>
                                    </div>
                                    {showAddress ? <EyeOff className="w-3.5 h-3.5 text-slate-400" /> : <Eye className="w-3.5 h-3.5 text-slate-400" />}
                                </div>
                                {showAddress && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(address || ''); alert("Address copied!"); }}
                                        className="p-1.5 bg-slate-100 rounded-lg border border-slate-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition text-slate-400"
                                    >
                                        <Copy className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center bg-slate-200 text-slate-600 rounded-full hover:bg-slate-300 transition-colors font-bold">✕</button>
                </div>

                <div className="flex p-2 bg-slate-50 border-b border-slate-100">
                    {['ASSETS', 'SEND', 'RECEIVE', 'ACTIVITY'].map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab as any)} className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${activeTab === tab ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' : 'text-slate-400 hover:text-slate-600'}`}>
                            {tab}
                        </button>
                    ))}
                </div>

                {!currentAddressName && (
                    <div className="bg-blue-600 p-3 flex items-center justify-between text-white animate-in slide-in-from-top duration-500">
                        <div className="flex items-center space-x-2">
                            <span className="text-sm">🆔</span>
                            <span className="text-[10px] font-bold uppercase tracking-wider">Identity not linked on-chain</span>
                        </div>
                        <button onClick={() => handleRegisterOnChain()} disabled={isRegisteringOnChain} className="bg-white text-blue-600 px-3 py-1 rounded-lg text-[10px] font-black uppercase hover:bg-slate-100 transition-colors disabled:opacity-50">
                            {isRegisteringOnChain ? 'Signing...' : 'Register @Name'}
                        </button>
                    </div>
                )}

                <div className="flex-1 p-6 relative flex flex-col min-h-[550px]">
                    {activeTab === 'ASSETS' && (
                        <div className="text-center py-8 flex-1">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Total Wallet Balance</p>
                            <h2 className="text-5xl font-black text-slate-900 mb-2 tracking-tight">${liquidDisplay}</h2>

                            <div className="mt-8 space-y-3">
                                <div className="p-4 rounded-2xl border border-slate-100 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer group">
                                    <div className="flex items-center">
                                        <div className="w-10 h-10 bg-[#2775ca] rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform">$</div>
                                        <div className="ml-3 text-left">
                                            <p className="font-bold text-slate-900 text-sm">USDC (Liquid)</p>
                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Available for transfers</p>
                                        </div>
                                    </div>
                                    <span className="font-bold text-slate-700">{liquidDisplay}</span>
                                </div>

                                {Number(savingsAssets) > 0 && (
                                    <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100 flex flex-col space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-700">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center">
                                                <div className="w-10 h-10 bg-[#005edc] rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md">🏦</div>
                                                <div className="ml-3 text-left">
                                                    <p className="font-bold text-blue-900 text-sm">{isWorker ? 'Earnings Savings' : 'Business Savings'}</p>
                                                    <p className="text-[9px] font-bold text-blue-400 uppercase tracking-tighter">{isWorker ? 'Earning 5% APY effectively' : 'Refunded from cancelled tasks'}</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-black text-blue-700 text-lg">${Number(savingsAssets).toFixed(4)}</p>
                                                {isWorker && <span className="text-[8px] bg-green-200 text-green-700 px-1 rounded font-bold">5% APY</span>}
                                            </div>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                if (!window.confirm("Withdraw all savings to your wallet?")) return;
                                                setIsWithdrawing(true);
                                                if (isCircle) {
                                                    try {
                                                        const savedUser = localStorage.getItem('arc_user');
                                                        if (!savedUser) throw new Error("User not found");
                                                        const user = JSON.parse(savedUser);
                                                        const userId = user.id || user.userId;
                                                        const userToken = localStorage.getItem('arc_session_token');
                                                        const encryptionKey = localStorage.getItem('arc_encryption_key');
                                                        const res = await axios.post('/api/circle/withdraw', { userId, amount: "0", userToken, encryptionKey });
                                                        const data = res.data;
                                                        if (data.error) throw new Error(data.error);
                                                        const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk');
                                                        const sdk = new W3SSdk();
                                                        sdk.setAppSettings({ appId: data.appId });
                                                        sdk.setAuthentication({ userToken: data.userToken, encryptionKey: data.encryptionKey });
                                                        await new Promise((resolve, reject) => {
                                                            sdk.execute(data.challengeId, (error: any, result: any) => {
                                                                if (error) reject(error);
                                                                else resolve(result);
                                                            });
                                                        });
                                                        alert("✅ Withdrawal Successful!");
                                                        refetchSavings();
                                                        fetchCircleBalance();
                                                    } catch (e: any) {
                                                        console.error("Circle Withdraw Error:", e);
                                                        if (!e.message?.includes("User rejected")) {
                                                            alert("Withdrawal Failed: " + (e.message || "Unknown Error"));
                                                        }
                                                    } finally {
                                                        setIsWithdrawing(false);
                                                    }
                                                } else {
                                                    writeWithdraw({
                                                        address: CONTRACTS.TaskEscrow.address,
                                                        abi: CONTRACTS.TaskEscrow.abi,
                                                        functionName: 'withdrawSavings',
                                                        args: [BigInt(0)]
                                                    });
                                                }
                                            }}
                                            disabled={isWithdrawing || isWithdrawConfirming}
                                            className="w-full h-10 bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-700 transition-all shadow-md active:scale-[0.98] disabled:opacity-50"
                                        >
                                            {isWithdrawing || isWithdrawConfirming ? 'Processing...' : 'Withdraw to Wallet'}
                                        </button>
                                    </div>
                                )}
                            </div>

                            <button onClick={() => isCircle ? fetchCircleBalance() : refetchWagmiBalance()} className="mt-8 text-xs font-bold text-slate-400 hover:text-blue-600">
                                {isCircleBalanceLoading || isWagmiBalanceLoading ? '↻ Updating...' : '↻ Refresh Balance'}
                            </button>
                        </div>
                    )}

                    {activeTab === 'SEND' && (
                        <div className="space-y-6 flex-1">
                            {isSuccess ? (
                                <div className="text-center py-10 animate-in zoom-in">
                                    <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl shadow-sm">✓</div>
                                    <h4 className="font-bold text-xl text-slate-900">Sent Successfully!</h4>
                                    <p className="text-sm text-slate-500 mt-2">Funds have been transferred.</p>
                                    <button onClick={() => { setActiveTab('ASSETS'); setAmount(''); setRecipient(''); setMemo(''); isCircle ? setIsCircleSuccess(false) : resetWagmiSend(); }} className="mt-8 w-full py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200">Done</button>
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Recipient</label>
                                        <input type="text" placeholder="@username or 0xAddress" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full p-4 bg-slate-50 rounded-2xl font-mono text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all border border-transparent focus:border-blue-500" />
                                        {contacts.length > 0 && recipient.length === 0 && (
                                            <div className="mt-4 animate-in fade-in">
                                                <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest mb-2">Recent</p>
                                                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                                                    {contacts.map((c, i) => (
                                                        <button key={i} onClick={() => setRecipient(c.name ? `@${c.name}` : c.address)} className="flex items-center gap-2 p-2 bg-white border border-slate-100 rounded-lg hover:border-blue-300 transition shrink-0 shadow-sm">
                                                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-[10px] font-bold">{c.name ? c.name[0].toUpperCase() : '0x'}</div>
                                                            <div className="text-left"><p className="text-xs font-bold text-slate-700">{c.name ? `@${c.name}` : `${c.address.substring(0, 6)}...`}</p></div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        <div className="h-6 mt-2">
                                            {recipient.startsWith('@') && recipient.length > 3 && (
                                                <>
                                                    {isResolvingName ? (
                                                        <span className="text-xs text-slate-400 flex items-center"><span className="w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mr-2"></span> Searching...</span>
                                                    ) : resolvedAddress ? (
                                                        <span className="text-xs text-green-600 font-bold flex items-center"><span>✓ Verified: </span><span className="font-mono ml-1 bg-green-50 px-1 rounded">{resolvedAddress.substring(0, 6)}...{resolvedAddress.substring(38)}</span></span>
                                                    ) : (
                                                        <span className="text-xs text-red-400 font-bold">User not found</span>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Amount</label>
                                        <div className="relative">
                                            <input type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full p-4 pl-4 pr-20 bg-slate-50 rounded-2xl text-3xl font-black text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
                                            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center space-x-2"><span className="text-sm font-bold text-slate-500">USDC</span></div>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Message (Optional)</label>
                                        <input type="text" placeholder="What's this for?" value={memo} onChange={(e) => setMemo(e.target.value)} className="w-full p-4 bg-slate-50 rounded-2xl text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all border border-transparent focus:border-blue-500" />
                                    </div>
                                    <div className="pt-4 mt-auto">
                                        <button onClick={handleDoSend} disabled={!amount || !isAddressValid || isPending || isConfirming} className="w-full py-4 bg-[#005ddb] text-white font-bold rounded-2xl hover:bg-blue-600 shadow-xl shadow-blue-500/20 transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center transform active:scale-95">
                                            {isPending || isConfirming ? 'Processing Transaction...' : 'Confirm Send'}
                                        </button>
                                    </div>
                                    {isConnectorError && (
                                        <div className="mt-4 p-4 bg-red-50 text-red-600 rounded-xl text-center">
                                            <p className="text-xs font-bold mb-2">Connection Lost</p>
                                            <button onClick={() => connect({ connector: connectors[0] })} className="px-4 py-2 bg-red-100 rounded-lg text-xs font-bold hover:bg-red-200">Reconnect Wallet</button>
                                        </div>
                                    )}
                                    {sendError && !isConnectorError && (
                                        <div className="p-3 bg-red-50 text-red-500 text-xs rounded-xl border border-red-100 mt-4 break-words">
                                            <p className="font-bold mb-1">Error:</p>
                                            {typeof sendError === 'string' ? sendError : (sendError as any).message || JSON.stringify(sendError)}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {activeTab === 'RECEIVE' && (
                        <div className="text-center py-8 flex flex-col items-center">
                            <div className="bg-white p-4 rounded-3xl border-2 border-slate-100 inline-block mb-6 shadow-sm">
                                <div className="w-56 h-56 bg-white border border-slate-100 rounded-xl flex items-center justify-center text-slate-300 relative overflow-hidden">
                                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${address}`} alt="Wallet QR Code" className="w-full h-full object-cover" />
                                </div>
                            </div>
                            <div className="bg-slate-50 p-4 rounded-2xl w-full">
                                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">Your Address</p>
                                <p className="text-xs text-slate-700 font-mono break-all select-all">{address}</p>
                            </div>
                            <button onClick={() => navigator.clipboard.writeText(address || '')} className="mt-4 w-full py-3 border-2 border-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-50 hover:text-blue-600 transition-colors">Copy Address</button>
                        </div>
                    )}

                    {activeTab === 'ACTIVITY' && (
                        <div className="flex-1 -mx-6 -mb-6 p-6 bg-slate-50 overflow-y-auto max-h-[400px]">
                            <div className="flex justify-between items-center mb-6">
                                <h4 className="font-bold text-slate-800">Social Feed</h4>
                                <button onClick={fetchSocialMemos} className="text-xs text-blue-600 font-bold">Refresh</button>
                            </div>
                            {isMemosLoading ? (
                                <div className="flex flex-col items-center justify-center py-20 opacity-50">
                                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                                    <p className="text-sm font-bold">Syncing social data...</p>
                                </div>
                            ) : socialMemos.length === 0 ? (
                                <div className="text-center py-20">
                                    <div className="text-4xl mb-4">💬</div>
                                    <p className="text-sm text-slate-500 font-medium">No messages yet.</p>
                                    <p className="text-xs text-slate-400 mt-1">Send a payment with a note to start.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {socialMemos.map((m, i) => {
                                        const isOutgoing = m.fromAddress?.toLowerCase() === address?.toLowerCase();
                                        const targetAddr = m.toAddress || '';
                                        const senderAddr = m.fromAddress || '';
                                        const targetName = socialNameMap[targetAddr.toLowerCase()];
                                        const senderName = socialNameMap[senderAddr.toLowerCase()];
                                        return (
                                            <div key={i} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-start space-x-3 transition-all hover:border-blue-200">
                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 shadow-sm ${isOutgoing ? 'bg-blue-600' : 'bg-green-600'}`}>
                                                    {isOutgoing ? '➜' : '⬅'}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex justify-between items-start">
                                                        <div className="flex flex-col">
                                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-0.5">{isOutgoing ? 'To' : 'From'}</p>
                                                            <div className="text-sm font-black text-slate-900 flex items-center mb-1">
                                                                {isOutgoing ? (
                                                                    targetName ? <div className="flex flex-col"><span className="text-blue-600">@{targetName}</span><span className="text-[10px] font-mono text-slate-400">{targetAddr.substring(0, 10)}...</span></div> : <span className="font-mono text-xs">{targetAddr.substring(0, 16)}...</span>
                                                                ) : (
                                                                    senderName ? <div className="flex flex-col"><span className="text-green-600">@{senderName}</span><span className="text-[10px] font-mono text-slate-400">{senderAddr.substring(0, 10)}...</span></div> : <span className="font-mono text-xs">{senderAddr.substring(0, 16)}...</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <p className="text-xs font-black text-slate-900 shrink-0">{isOutgoing ? '-' : '+'}{m.amount} {m.symbol || 'USDC'}</p>
                                                    </div>
                                                    <div className="mt-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
                                                        <p className="text-sm text-slate-700 font-medium italic">"{m.memo}"</p>
                                                    </div>
                                                    <p className="text-[10px] text-slate-400 mt-2 font-bold uppercase tracking-tighter">{new Date(m.createdAt).toLocaleString()}</p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
