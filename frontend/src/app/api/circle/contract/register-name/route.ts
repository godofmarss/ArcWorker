import { NextResponse } from 'next/server';
import { createCircleContractCall, getCircleWallet } from '@/arcworker-sdk/wallet/server';
import { CONTRACTS } from '@/utils/contracts';
import axios from 'axios';
import crypto from 'crypto';

// Developer-controlled wallet client
const devClient = axios.create({
    baseURL: 'https://api.circle.com/v1/w3s',
    headers: { 'Content-Type': 'application/json' },
});

devClient.interceptors.request.use((config) => {
    const key = (process.env.CIRCLE_TELEGRAM_API_KEY || process.env.CIRCLE_API_KEY || '').replace(/['"]+/g, '').trim();
    config.headers['Authorization'] = `Bearer ${key}`;
    return config;
});

/**
 * Generate entity secret ciphertext for dev wallet transactions.
 */
async function generateEntitySecretCiphertext(entitySecret: string): Promise<string> {
    const pubKeyRes = await devClient.get('/config/entity/publicKey');
    const publicKeyPem = pubKeyRes.data.data.publicKey;

    const encrypted = crypto.publicEncrypt(
        {
            key: publicKeyPem,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
        },
        Buffer.from(entitySecret, 'hex')
    );

    return encrypted.toString('base64');
}

/**
 * Execute a contract call server-side for a dev-controlled wallet.
 * No PIN or user interaction needed.
 */
async function devWalletContractCall(
    walletId: string,
    contractAddress: string,
    abiFunctionSignature: string,
    abiParameters: any[]
): Promise<string> {
    const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || '').replace(/['"]+/g, '').trim();
    if (!entitySecret) throw new Error('CIRCLE_ENTITY_SECRET not configured');

    const ciphertext = await generateEntitySecretCiphertext(entitySecret);

    const payload = {
        idempotencyKey: crypto.randomUUID(),
        entitySecretCiphertext: ciphertext,
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters,
        feeLevel: 'HIGH',
    };

    console.log(`[Dev Register] Executing ${abiFunctionSignature} on ${contractAddress}`);

    const res = await devClient.post('/developer/transactions/contractExecution', payload);
    const transactionId = res.data.data?.id;

    if (!transactionId) {
        console.error('[Dev Register] No transaction ID returned:', JSON.stringify(res.data, null, 2));
        throw new Error('No transaction ID returned from Circle');
    }

    console.log(`[Dev Register] Transaction submitted: ${transactionId}`);
    return transactionId;
}

/**
 * Get wallet ID for a dev-controlled wallet by address.
 */
async function getDevWalletId(walletAddress: string): Promise<string | null> {
    try {
        // List all dev wallets and find by address
        let pageAfter: string | undefined;
        do {
            const res = await devClient.get('/wallets', {
    params: { pageSize: 50, ...(pageAfter ? { pageAfter } : {}) }
});
            const wallets = res.data.data?.wallets || [];
            const match = wallets.find((w: any) => 
                w.address?.toLowerCase() === walletAddress.toLowerCase()
            );
            if (match) {
                console.log(`[Dev Register] Found wallet ID: ${match.id}`);
                return match.id;
            }
            pageAfter = res.data.data?.pageAfter;
        } while (pageAfter);

        console.error('[Dev Register] Wallet not found in dev wallet list');
        return null;
    } catch (e: any) {
        console.error('[Dev Register] Failed to list wallets:', e.response?.data || e.message);
        return null;
    }
}

export async function POST(request: Request) {
    try {
        let { userToken, username, walletAddress, isDev } = await request.json();
        username = username?.toLowerCase();

        if (!username) {
            return NextResponse.json({ error: 'Missing username' }, { status: 400 });
        }

        // --- DEV CIRCLE FLOW (Telegram wallets) ---
        if (isDev && walletAddress) {
            console.log(`[Dev Register] Registering @${username} for dev wallet ${walletAddress}`);

            // Find the wallet ID from address
            const walletId = await getDevWalletId(walletAddress);
            if (!walletId) {
                return NextResponse.json({ error: 'Dev wallet not found for address: ' + walletAddress }, { status: 404 });
            }

            // Execute registration server-side — no challenge needed
            const transactionId = await devWalletContractCall(
                walletId,
                CONTRACTS.UserRegistry.address,
                'register(string)',
                [username]
            );

            return NextResponse.json({
                success: true,
                transactionId,
                isDev: true,
                message: `@${username} registration submitted. Transaction: ${transactionId}`
            });
        }

        // --- REGULAR CIRCLE FLOW (Email wallets) ---
        if (!userToken) {
            return NextResponse.json({ error: 'Missing userToken' }, { status: 400 });
        }

        const wallet = await getCircleWallet(userToken);
        if (!wallet) {
            return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });
        }

        const challengeId = await createCircleContractCall(
            userToken,
            wallet.id,
            CONTRACTS.UserRegistry.address,
            'register(string)',
            [username]
        );

        return NextResponse.json({ challengeId });

    } catch (error: any) {
        const errorData = error.response?.data || { message: error.message };
        const status = error.response?.status || 500;
        console.error('[On-Chain Register] Error:', JSON.stringify(errorData, null, 2));
        return NextResponse.json({
            error: 'Registration Failed',
            details: errorData
        }, { status });
    }
}
