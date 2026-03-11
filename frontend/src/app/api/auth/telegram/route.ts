import { NextResponse } from 'next/server';
import { getUserByEmailOrUsername, createUser } from '@/utils/db';
import axios from 'axios';
import crypto from 'crypto';

// Developer-controlled wallet client
const devClient = axios.create({
    baseURL: 'https://api.circle.com/v1/w3s',
    headers: { 'Content-Type': 'application/json' },
});

devClient.interceptors.request.use((config) => {
    const key = (process.env.CIRCLE_API_KEY || '').replace(/['"]+/g, '').trim();
    config.headers['Authorization'] = `Bearer ${key}`;
    return config;
});

/**
 * Generate entity secret ciphertext required by Circle dev wallet API.
 */
async function generateEntitySecretCiphertext(entitySecret: string): Promise<string> {
    // Fetch Circle's public key for encryption
    const pubKeyRes = await devClient.get('/config/entity/publicKey');
    const publicKeyPem = pubKeyRes.data.data.publicKey;

    const entitySecretBytes = Buffer.from(entitySecret, 'hex');

    const encrypted = crypto.publicEncrypt(
        {
            key: publicKeyPem,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
        },
        entitySecretBytes
    );

    return encrypted.toString('base64');
}

/**
 * Create a developer-controlled wallet for a Telegram user.
 * No PIN, no security questions needed.
 */
async function createDevWallet(telegramId: string): Promise<{ walletId: string; address: string } | null> {
    try {
        const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || '').replace(/['"]+/g, '').trim();

        if (!entitySecret) {
            console.error('[TelegramAuth] CIRCLE_ENTITY_SECRET is not set!');
            return null;
        }

        const ciphertext = await generateEntitySecretCiphertext(entitySecret);

        // Step 1: Create a wallet set for this user
        const wsRes = await devClient.post('/developer/walletSets', {
            idempotencyKey: crypto.randomUUID(),
            entitySecretCiphertext: ciphertext,
            name: `tg_${telegramId}`,
        });
        const walletSetId = wsRes.data.data.walletSet.id;
        console.log(`[TelegramAuth] Created wallet set: ${walletSetId}`);

        // Step 2: Create wallet in the set
        const ciphertext2 = await generateEntitySecretCiphertext(entitySecret);
        const walletRes = await devClient.post('/developer/wallets', {
            idempotencyKey: crypto.randomUUID(),
            entitySecretCiphertext: ciphertext2,
            walletSetId,
            blockchains: ['ARC-TESTNET'],
            count: 1,
            accountType: 'SCA',
            metadata: [{ name: `tg_${telegramId}`, refId: `telegram_${telegramId}` }],
        });

        const wallet = walletRes.data.data.wallets?.[0];
        if (!wallet) return null;

        console.log(`[TelegramAuth] Dev wallet created: ${wallet.address}`);
        return { walletId: wallet.id, address: wallet.address };

    } catch (e: any) {
        console.error('[TelegramAuth] createDevWallet failed:', e.response?.data || e.message);
        return null;
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { telegramId, telegramUsername, telegramName } = body;

        if (!telegramId) {
            return NextResponse.json({ error: 'Missing Telegram ID' }, { status: 400 });
        }

        const syntheticEmail = `tg_${telegramId}@telegram.arcworker`;
        const username = telegramUsername || `tg_${telegramId}`;
        const displayName = telegramName || username;

        // Check if user already exists
        const existingUser = await getUserByEmailOrUsername(syntheticEmail).catch(() => null)
            || await getUserByEmailOrUsername(username).catch(() => null);

        if (existingUser) {
            console.log(`[Telegram Auth] Existing user login: ${username}`);
            return NextResponse.json({
                success: true,
                isNewUser: false,
                user: {
                    username: existingUser.username,
                    name: displayName,
                    role: existingUser.role || 'worker',
                    walletType: 'dev_circle',
                    email: syntheticEmail,
                    id: syntheticEmail,
                    userId: syntheticEmail,
                    walletAddress: existingUser.wallet_address || existingUser.walletAddress,
                    telegramId,
                    telegramUsername: username,
                },
                walletAddress: existingUser.wallet_address || existingUser.walletAddress,
            });
        }

        // --- NEW USER: REGISTER ---
        console.log(`[Telegram Auth] New Telegram user: ${username}`);

        const walletResult = await createDevWallet(telegramId);
        const walletAddress = walletResult?.address || '';

        await createUser({
            username,
            password: `tg_${telegramId}_${Date.now()}`,
            email: syntheticEmail,
            walletAddress,
            role: 'worker',
            walletType: 'dev_circle',
            userId: syntheticEmail,
        });

        console.log(`[Telegram Auth] Registered: ${username} | Wallet: ${walletAddress}`);

        return NextResponse.json({
            success: true,
            isNewUser: true,
            user: {
                username,
                name: displayName,
                role: 'worker',
                walletType: 'dev_circle',
                email: syntheticEmail,
                id: syntheticEmail,
                userId: syntheticEmail,
                walletAddress,
                telegramId,
                telegramUsername: username,
            },
            walletAddress,
        });

    } catch (error: any) {
        console.error('[Telegram Auth] CRITICAL ERROR:', error.message);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
