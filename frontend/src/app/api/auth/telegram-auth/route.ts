import { NextResponse } from 'next/server';
import { getUserByEmailOrUsername, createUser } from '@/utils/db';
import { sql } from '@vercel/postgres';
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
    const entitySecretBytes = Buffer.from(entitySecret, 'hex');
    const encrypted = crypto.publicEncrypt(
        { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        entitySecretBytes
    );
    return encrypted.toString('base64');
}

async function createDevWallet(telegramId: string): Promise<{ walletId: string; address: string } | null> {
    try {
        const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || '').replace(/['"]+/g, '').trim();
        if (!entitySecret) {
            console.error('[TelegramAuth] CIRCLE_ENTITY_SECRET is not set!');
            return null;
        }

        const ciphertext = await generateEntitySecretCiphertext(entitySecret);
        const wsRes = await devClient.post('/developer/walletSets', {
            idempotencyKey: crypto.randomUUID(),
            entitySecretCiphertext: ciphertext,
            name: `tg_${telegramId}`,
        });
        const walletSetId = wsRes.data.data.walletSet.id;

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

        // --- CHECK 1: Is this Telegram ID already linked to a web account? ---
        const linkedResult = await sql`
    SELECT id, username, email, role, wallet_address, wallet_type, telegram_id
    FROM users 
    WHERE telegram_id = ${String(telegramId)}
`.catch(() => ({ rows: [] }));

        if (linkedResult.rows.length > 0) {
            const linkedUser = linkedResult.rows[0];
            console.log(`[Telegram Auth] Linked account login: ${linkedUser.username}`);
            return NextResponse.json({
                success: true,
                isNewUser: false,
                isLinked: true,
                user: {
                    username: linkedUser.username,
                    name: displayName,
                    role: linkedUser.role || 'worker',
                    walletType: linkedUser.wallet_type || 'circle',
                    email: linkedUser.email,
                    id: linkedUser.email,
                    userId: linkedUser.email,
                    walletAddress: linkedUser.wallet_address,
                    telegramId,
                    telegramUsername: username,
                },
                walletAddress: linkedUser.wallet_address,
            });
        }

        // --- CHECK 2: Does a Telegram-native account already exist? ---
        const existingUser = await getUserByEmailOrUsername(syntheticEmail).catch(() => null)
            || await getUserByEmailOrUsername(username).catch(() => null);

        if (existingUser) {
            console.log(`[Telegram Auth] Existing Telegram user login: ${username}`);
            if (!existingUser.telegram_id) {
                await sql`UPDATE users SET telegram_id = ${telegramId.toString()} WHERE id = ${existingUser.id}`.catch(() => {});
            }
            return NextResponse.json({
                success: true,
                isNewUser: false,
                user: {
                    username: existingUser.username,
                    name: displayName,
                    role: existingUser.role || 'worker',
                    walletType: existingUser.wallet_type || 'dev_circle',
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

        // --- CHECK 3: New user — prompt to link or create new ---
        console.log(`[Telegram Auth] New user, prompting link or create: ${username}`);
        return NextResponse.json({
            success: true,
            isNewUser: true,
            promptLink: true,
            telegramId,
            telegramUsername: username,
            displayName,
        });

    } catch (error: any) {
        console.error('[Telegram Auth] CRITICAL ERROR:', error.message);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}

// Called when user chooses "I'm new" — creates fresh dev_circle account
export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const { telegramId, telegramUsername, telegramName } = body;

        const syntheticEmail = `tg_${telegramId}@telegram.arcworker`;
        const username = telegramUsername || `tg_${telegramId}`;
        const displayName = telegramName || username;

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

        await sql`UPDATE users SET telegram_id = ${String(telegramId)} WHERE email = ${syntheticEmail}`.catch(() => {});

        console.log(`[Telegram Auth] Registered new user: ${username} | Wallet: ${walletAddress}`);

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
        console.error('[Telegram Auth] Registration error:', error.message);
        return NextResponse.json({ error: 'Registration failed', details: error.message }, { status: 500 });
    }
}
