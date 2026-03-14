import axios from 'axios';
import crypto from 'crypto';

// ArcWorker Server-Side Wallet Utilities
// Backend integration with Circle Programmable Wallets API

// Production URL (Test Mode keys work here too)
const circleClient = axios.create({
    baseURL: 'https://api.circle.com/v1/w3s',
    headers: {
        'Content-Type': 'application/json',
    }
});

// Ensure key and environment are determined on every request
circleClient.interceptors.request.use((config) => {
    const rawKey = process.env.CIRCLE_API_KEY;
    if (!rawKey) {
        console.error('[ArcWorker SDK] CRITICAL: CIRCLE_API_KEY is missing!');
        throw new Error('Circle API Key is not configured in .env');
    }

    const cleanKey = rawKey.replace(/['"]+/g, '').trim();
    const isSandbox = cleanKey.includes('TEST');

    config.headers['Authorization'] = `Bearer ${cleanKey}`;

    console.log(`[ArcWorker SDK] Request: ${config.method?.toUpperCase()} ${config.url} | Mode: ${isSandbox ? 'SANDBOX' : 'PRODUCTION'}`);
    return config;
});

/**
 * Identity Bridge: Checks for the user and their aliased versions.
 * Prioritizes the version that already exists in Circle.
 */
export async function getOrCreateCircleUser(userId: string) {
    // Normalize: Strip prefixes and suffixes to get the core username
    let rawId = userId.split('@')[0];
    rawId = rawId.replace(/^arc_user_/, ''); // Strip historical prefix

    // 1. Try to find any version
    const candidates = [
        userId,                                     // full: "mockaf506@gmail.com"
        rawId,                                      // raw: "mockaf506"
        `${rawId}@arcworker.user`,                  // suffixed: "mockaf506@arcworker.user"
        `arc_user_${rawId}`,                         // prefixed: "arc_user_mockaf506"
    ];

    // Add sanitized version if rawId has special chars
    const sanitized = rawId.replace(/[^a-z0-9]/g, '_');
    if (sanitized !== rawId) {
        candidates.push(sanitized);
        candidates.push(`arc_user_${sanitized}`);
    }

    // De-duplicate
    const uniqueCandidates = Array.from(new Set(candidates));

    for (const id of uniqueCandidates) {
        try {
            console.log(`[ArcWorker Server] Probing identity: ${id}`);
            const response = await circleClient.get(`/users/${id}`);
            if (response.data.data) {
                const circleId = response.data.data.id || id;
                console.log(`[ArcWorker Server] Using existing identity: ${circleId}`);
                return { ...response.data.data, userId: circleId }; // Return with the canonical ID found
            }
        } catch (e: any) {
            // Not found, try next
        }
    }

    // 2. If neither exists, create using the requested one (defaulting to suffixed for future-proofing)
    const targetId = userId.includes('@') ? userId : `${userId}@arcworker.user`;
    try {
        console.log(`[ArcWorker Server] Creating new identity: ${targetId}`);
        const response = await circleClient.post('/users', { userId: targetId });
        return { ...response.data.data, userId: targetId };
    } catch (createError: any) {
        const errorMsg = createError.response?.data?.message || "";
        if (errorMsg.includes("already created") || createError.response?.status === 409) {
            console.log(`[ArcWorker Server] Identity collision detected for ${targetId}. Retrieving existing...`);
            const response = await circleClient.get(`/users/${targetId}`);
            const circleId = response.data.data?.id || targetId;
            return { ...response.data.data, userId: circleId };
        }
        console.error(`[ArcWorker Server] CRITICAL: User Creation Failed:`, createError.response?.data || createError.message);
        throw createError;
    }
}

export async function createCircleSession(userId: string) {
    try {
        // Use the bridge to get the CORRECT ID even if a mismatched one was passed
        const user = await getOrCreateCircleUser(userId);
        const actualId = user.userId || userId;

        const response = await circleClient.post('/users/token', { userId: actualId });
        return {
            userToken: response.data.data.userToken,
            encryptionKey: response.data.data.encryptionKey,
            userId: actualId
        };
    } catch (error: any) {
        throw error;
    }
}

export async function verifyCircleSession(userToken: string, expectedUserId: string) {
    try {
        const response = await circleClient.get('/user', {
            headers: { 'X-User-Token': userToken }
        });
        const actualId = response.data.data?.userId;
        const matches = actualId === expectedUserId;

        console.log(` [Circle Verify] Token ID: ${actualId} | Expected: ${expectedUserId} | Match: ${matches}`);

        return matches;
    } catch (e: any) {
        console.warn(` [Circle Verify] Error checking token:`, e.response?.data || e.message);
        return false;
    }
}

export async function getUserIdFromToken(userToken: string) {
    try {
        const response = await circleClient.get('/user', {
            headers: { 'X-User-Token': userToken }
        });
        const userId = response.data.data?.userId || response.data.data?.id;
        console.log(` [Circle Token Info] Resolved User ID: ${userId}`);

        if (!userId) {
            console.warn(` [Circle Token Info] Full User Response:`, JSON.stringify(response.data.data, null, 2));
        }

        return userId || null;
    } catch (e: any) {
        console.warn(` [Circle Token Info] Failed to get identity from token:`, e.response?.data || e.message);
        return null;
    }
}

export async function createCircleEmailSession(email: string, deviceId: string) {
    try {
        const response = await circleClient.post('/users/email/token', {
            email,
            deviceId,
            idempotencyKey: crypto.randomUUID()
        });
        return {
            deviceToken: response.data.data.deviceToken,
            deviceEncryptionKey: response.data.data.deviceEncryptionKey,
            otpToken: response.data.data.otpToken
        };
    } catch (error: any) {
        console.error('[ArcWorker] Error in createCircleEmailSession:', error.response?.data || error.message);
        throw error;
    }
}

export async function createCircleSocialSession(provider: 'google' | 'apple' | 'facebook', userId?: string, deviceId?: string) {
    try {
        const response = await circleClient.post('/users/social/token', {
            provider,
            userId,
            deviceId,
            idempotencyKey: crypto.randomUUID()
        });
        // This returns deviceToken and deviceEncryptionKey for the SDK to perform login
        return {
            deviceToken: response.data.data.deviceToken,
            deviceEncryptionKey: response.data.data.deviceEncryptionKey
        };
    } catch (error: any) {
        console.error(`[ArcWorker] Error in createCircleSocialSession (${provider}):`, error.response?.data || error.message);
        throw error;
    }
}


export async function initializeCircleWallet(userToken: string) {
    const response = await circleClient.post('/user/initialize', {
        idempotencyKey: crypto.randomUUID(),
        accountType: 'SCA',
        blockchains: ['ARC-TESTNET'],
    }, {
        headers: { 'X-User-Token': userToken }
    });
    return response.data.data.challengeId;
}

/**
 * RE-ADDED for compatibility: Returns a single wallet (prioritizes ARC-TESTNET).
 */
export async function getCircleWallet(userToken: string) {
    const wallets = await getCircleWallets(userToken);
    if (!wallets || wallets.length === 0) return null;

    // Prioritize ARC-TESTNET wallet
    const arcWallet = wallets.find((w: any) => w.blockchain === 'ARC-TESTNET');
    if (arcWallet) return arcWallet;

    // Fallback to first wallet
    return wallets[0];
}

/**
 * Returns the full list of wallets for a user.
 */
export async function getCircleWallets(userToken: string) {
    try {
        const response = await circleClient.get('/wallets', {
            headers: { 'X-User-Token': userToken }
        });
        const wallets = response.data.data.wallets;

        console.log(`[ArcWorker SDK] Found ${wallets?.length || 0} wallet(s).`);
        return wallets || [];
    } catch (e: any) {
        console.error('[ArcWorker SDK] getCircleWallets Failed:', e.response?.data || e.message);
        throw e;
    }
}

/**
 * Exhaustive search for a wallet with funds on ARC-TESTNET.
 * Useful when multiple wallets exist due to recovery/reset.
 */
export async function findFundedWallet(userToken: string, requiredAmount: string) {
    const wallets = await getCircleWallets(userToken);
    console.log(`[ArcWorker SDK] findFundedWallet: Scanning ${wallets?.length || 0} wallets for balance >= ${requiredAmount}...`);

    if (!wallets || wallets.length === 0) {
        console.warn(`[ArcWorker SDK] findFundedWallet: User has NO wallets initialized.`);
        return { wallet: null, balances: [] };
    }

    for (const wallet of wallets) {
        if (wallet.blockchain !== 'ARC-TESTNET') {
            console.log(` [Scan] Skipping non-ARC wallet: ${wallet.address} (${wallet.blockchain})`);
            continue;
        }

        try {
            const balances = await getCircleBalances(userToken, wallet.id);
            const native = balances.find((b: any) => b.token?.isconst anyToken = balances.find((b: any) => 
    b.token?.isNative || 
    b.token?.symbol === 'ETH' || 
    b.token?.symbol === 'MATIC' ||
    b.token?.symbol === 'USDC' ||
    b.token?.symbol === 'ARC'
);
const amount = parseFloat(anyToken?.amount || '0'); || b.token?.symbol === 'ETH' || b.token?.symbol === 'MATIC');
            const amount = parseFloat(native?.amount || '0');

            console.log(` -> Wallet: ${wallet.address.substring(0, 10)}... | Balance: ${amount} | ID: ${wallet.id}`);

            if (amount >= parseFloat(requiredAmount)) {
                console.log(`[ArcWorker SDK] MATCH FOUND: Using wallet ${wallet.id}`);
                return { wallet, balances };
            }
        } catch (e: any) {
            console.warn(` [Scan] Failed to check wallet ${wallet.id}: ${e.message}`);
        }
    }

    console.log(`[ArcWorker SDK] No funded wallet found among ${wallets.length} accounts. Falling back to first wallet.`);
    return { wallet: wallets[0], balances: [] };
}

export async function getCircleBalances(userToken: string, walletId: string) {
    try {
        console.log(`[ArcWorker SDK] Fetching balances for Wallet ${walletId}...`);
        const response = await circleClient.get(`/wallets/${walletId}/balances`, {
            headers: { 'X-User-Token': userToken }
        });
        const balances = response.data.data.tokenBalances;

        return balances || [];
    } catch (e: any) {
        console.error('[ArcWorker SDK] getCircleBalances Failed:', e.response?.data || e.message);
        throw e;
    }
}

// End of first section

export async function createSecurityQuestionsChallenge(userToken: string) {
    const response = await circleClient.post('/user/securityQuestion', {
        idempotencyKey: crypto.randomUUID(),
    }, {
        headers: { 'X-User-Token': userToken }
    });
    return response.data.data.challengeId;
}

export async function createCircleTransfer(userToken: string, walletId: string, destinationAddress: string, amount: string, tokenId?: string) {
    const payload: any = {
        idempotencyKey: crypto.randomUUID(),
        walletId,
        destinationAddress,
        amounts: [amount.toString()],
        feeLevel: 'HIGH',
        blockchain: 'ARC-TESTNET',
    };

    if (tokenId) {
        payload.tokenId = tokenId;
    }

    console.log(`[ArcWorker Server] Creating Transfer:`, JSON.stringify(payload, null, 2));

    try {
        const response = await circleClient.post('/user/transactions/transfer', payload, {
            headers: { 'X-User-Token': userToken }
        });
        return response.data.data.challengeId;
    } catch (e: any) {
        const errorData = e.response?.data || e.message;
        console.error(`[ArcWorker Server] Transfer Failed. Details:`, JSON.stringify(errorData, null, 2));
        throw e;
    }
}

export async function getChallengeStatus(userToken: string, challengeId: string) {
    try {
        const response = await circleClient.get(`/user/challenges/${challengeId}`, {
            headers: { 'X-User-Token': userToken }
        });
        return response.data.data;
    } catch (e: any) {
        console.error(`[ArcWorker Server] Get Challenge Status Failed:`, e.message);
        throw e;
    }
}

export async function getTransactionStatus(userToken: string, transactionId: string) {
    try {
        const response = await circleClient.get(`/user/transactions/${transactionId}`, {
            headers: { 'X-User-Token': userToken }
        });
        return response.data.data;
    } catch (e: any) {
        console.error(`[ArcWorker Server] Get Transaction Status Failed:`, e.message);
        throw e;
    }
}

export async function getCircleUserTransactions(userToken: string) {
    try {
        console.log(`[ArcWorker SDK] Attempting to fetch transactions (Global Scan)...`);

        const wallets = await getCircleWallets(userToken);
        const walletIds = (wallets || []).map((w: any) => w.id);

        const params: any = { pageSize: 15 }; // Fetch more for safety
        if (walletIds.length > 0) {
            params.walletIds = walletIds;
            console.log(`[ArcWorker SDK] Filtering by Wallet IDs: ${walletIds.join(', ')}`);
        }

        const res = await circleClient.get('/transactions', {
            params,
            headers: { 'X-User-Token': userToken }
        });

        return res.data.data.transactions || [];
    } catch (e: any) {
        console.error(`[ArcWorker Server] Get User Transactions FAILURE:`, e.response?.data || e.message);
        return [];
    }
}



export async function restoreUser(userToken: string) {
    try {
        // DIAGNOSTIC: Check User Status first
        console.log("[ArcWorker Server] Checking User Status before Restore...");
        try {
            const statusRes = await circleClient.get('/user', {
                headers: { 'X-User-Token': userToken }
            });
            console.log("[ArcWorker Server] User Status:", JSON.stringify(statusRes.data.data, null, 2));
        } catch (statusErr: any) {
            console.warn("[ArcWorker Server] Could not fetch user status:", statusErr.message);
        }

        console.log("[ArcWorker Server] Initiating Restore via /user/pin/restore...");
        const response = await circleClient.post('/user/pin/restore', {
            idempotencyKey: crypto.randomUUID()
        });
        return response.data.data.challengeId;
    } catch (e: any) {
        console.error(`[ArcWorker Server] Restore User Failed:`, e.response?.data || e.message);
        throw e;
    }
}

export async function initiateRecovery(userToken: string, username: string) {
    try {
        // 1. Get User's Wallet ID (Required for Sign Message)
        const wallet = await getCircleWallet(userToken);
        if (!wallet) {
            console.error(`[ArcWorker Server] No wallet found for user ${username} during recovery.`);
            throw new Error("User has no initialized wallet. Recovery cannot proceed.");
        }
        const walletId = wallet.id;
        console.log(`[ArcWorker Server] Resolved Wallet ID for Recovery: ${walletId}`);

        const message = `I authorize password reset for ${username} at ${new Date().toISOString()}`;
        // Encode message in hex as standard for EIP-191/Circle
        const messageHex = Buffer.from(message, 'utf8').toString('hex');

        console.log(`[ArcWorker Server] Initiating Sign Message Challenge for recovery: ${username}`);
        const response = await circleClient.post('/user/sign/message', {
            idempotencyKey: crypto.randomUUID(),
            walletId: walletId,
            message: `0x${messageHex}`
        }, {
            headers: { 'X-User-Token': userToken }
        });

        return {
            challengeId: response.data.data.challengeId,
            message: message
        };
    } catch (e: any) {
        console.error(`[ArcWorker Server] Recovery Init Failed:`, e.response?.data || e.message);
        throw e;
    }
}

export async function verifyRecovery(userToken: string, challengeId: string) {
    try {
        const challenge = await getChallengeStatus(userToken, challengeId);
        console.log(`[ArcWorker Server] Challenge Status Response:`, JSON.stringify(challenge, null, 2));

        // Handle potential nesting (data.challenge vs data)
        const status = challenge.status || challenge.challenge?.status;

        if (status === 'COMPLETE') {
            return {
                valid: true,
                signature: challenge.result?.signature || challenge.challenge?.result?.signature,
            };
        }
        return { valid: false, status: status };
    } catch (e: any) {
        console.error(`[ArcWorker Server] Recovery Verify Failed:`, e.message);
        throw e;
    }
}
export async function createCircleContractCall(userToken: string, walletId: string, contractAddress: string, abiFunctionSignature: string, abiParameters: any[], amount?: string) {
    const payload: any = {
        idempotencyKey: crypto.randomUUID(),
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters,
        feeLevel: 'HIGH',
    };

    if (amount) {
        payload.amount = amount;
    }

    console.log(`[ArcWorker Server] Creating Contract Call:`, JSON.stringify(payload, null, 2));

    try {
        const response = await circleClient.post('/user/transactions/contractExecution', payload, {
            headers: { 'X-User-Token': userToken }
        });

        console.log(`[ArcWorker SDK] Contract Execution Response Data:`, JSON.stringify(response.data, null, 2));

        const challengeId = response.data.data?.challengeId;
        if (!challengeId) {
            console.error("[ArcWorker SDK] Circle Response missing challengeId:", JSON.stringify(response.data, null, 2));
            throw new Error("Circle API did not return a challengeId");
        }
        return challengeId;
    } catch (e: any) {
        const errorData = e.response?.data || e.message;
        console.error(`[ArcWorker Server] Contract Call Failed. Status: ${e.response?.status}. Details:`, JSON.stringify(errorData, null, 2));
        throw e;
    }
}
// Backward compatibility alias
export const callCircleContract = createCircleContractCall;
