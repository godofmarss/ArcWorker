import { NextResponse } from 'next/server';
import { createCircleSession, findFundedWallet, createCircleTransfer } from '@/arcworker-sdk/wallet/server';
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

async function generateEntitySecretCiphertext(entitySecret: string): Promise<string> {
    const pubKeyRes = await devClient.get('/config/entity/publicKey');
    const publicKeyPem = pubKeyRes.data.data.publicKey;
    const encrypted = crypto.publicEncrypt(
        { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(entitySecret, 'hex')
    );
    return encrypted.toString('base64');
}

async function getDevWalletId(walletAddress: string): Promise<string | null> {
    try {
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
                console.log(`[Dev Transfer] Found wallet ID: ${match.id}`);
                return match.id;
            }
            pageAfter = res.data.data?.pageAfter;
        } while (pageAfter);
        return null;
    } catch (e: any) {
        console.error('[Dev Transfer] Failed to list wallets:', e.response?.data || e.message);
        return null;
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { fromAddress, toAddress, amount, isDev, userId, userToken } = body;

        if (!toAddress || !amount) {
            return NextResponse.json({ error: 'Missing toAddress or amount' }, { status: 400 });
        }

        // --- DEV CIRCLE FLOW (Telegram wallets) ---
        if (isDev && fromAddress) {
            console.log(`[Dev Transfer] ${fromAddress} → ${toAddress} | Amount: ${amount}`);

            const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || '').replace(/['"]+/g, '').trim();
            if (!entitySecret) {
                return NextResponse.json({ error: 'CIRCLE_ENTITY_SECRET not configured' }, { status: 500 });
            }

            const walletId = await getDevWalletId(fromAddress);
            if (!walletId) {
                return NextResponse.json({ error: 'Source wallet not found' }, { status: 404 });
            }

            const ciphertext = await generateEntitySecretCiphertext(entitySecret);

            const res = await devClient.post('/developer/transactions/transfer', {
                idempotencyKey: crypto.randomUUID(),
                entitySecretCiphertext: ciphertext,
                walletId,
                destinationAddress: toAddress,
                amounts: [amount.toString()],
                feeLevel: 'HIGH',
                tokenAddress: '0x3600000000000000000000000000000000000000',
                blockchain: 'ARC-TESTNET',
            });

            const transactionId = res.data.data?.id;
            console.log(`[Dev Transfer] Transaction submitted: ${transactionId}`);

            return NextResponse.json({
                success: true,
                transactionId,
                message: `Transfer of ${amount} USDC submitted successfully.`
            });
        }

        // --- REGULAR CIRCLE FLOW (Email wallets) ---
        if (!userId && !userToken) {
            return NextResponse.json({ error: 'Missing userId or userToken' }, { status: 400 });
        }

        const session = userToken
            ? { userToken, encryptionKey: '' }
            : await createCircleSession(userId);

        const { wallet } = await findFundedWallet(session.userToken, amount);
        if (!wallet) {
            return NextResponse.json({ error: 'No funded wallet found' }, { status: 400 });
        }

        const challengeId = await createCircleTransfer(
    session.userToken,
    wallet.id,
    toAddress,
    amount,
    wallet.tokenId || undefined
);

        return NextResponse.json({
            success: true,
            challengeId,
            userToken: session.userToken,
        });

    } catch (error: any) {
        const errorData = error.response?.data || { message: error.message };
        console.error('[Transfer] Error:', JSON.stringify(errorData, null, 2));
        return NextResponse.json({
            error: 'Transfer failed',
            details: errorData
        }, { status: error.response?.status || 500 });
    }
}
