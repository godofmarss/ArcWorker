import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import axios from 'axios';
import crypto from 'crypto';

// Dev wallet client
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

async function createDevWallet(telegramId: string): Promise<string | null> {
    try {
        const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || '').replace(/['"]+/g, '').trim();
        if (!entitySecret) return null;

        const ciphertext = await generateEntitySecretCiphertext(entitySecret);
        const wsRes = await devClient.post('/developer/walletSets', {
            idempotencyKey: crypto.randomUUID(),
            entitySecretCiphertext: ciphertext,
            name: `tg_linked_${telegramId}`,
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
            metadata: [{ name: `tg_linked_${telegramId}`, refId: `telegram_linked_${telegramId}` }],
        });

        const wallet = walletRes.data.data.wallets?.[0];
        if (!wallet) return null;

        console.log(`[Verify OTP] Created Telegram wallet: ${wallet.address}`);
        return wallet.address;

    } catch (e: any) {
        console.error('[Verify OTP] createDevWallet failed:', e.response?.data || e.message);
        return null;
    }
}

export async function POST(request: Request) {
    try {
        const { email, otp, telegramId, telegramUsername } = await request.json();

        if (!email || !otp || !telegramId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Find user and check OTP
        const result = await sql`
            SELECT id, username, email, role, wallet_address, wallet_type, otp_code, otp_expires_at, telegram_id, telegram_wallet_address
            FROM users 
            WHERE email = ${email.toLowerCase()}
        `;

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const user = result.rows[0];

        // Check if already linked to a different Telegram account
        if (user.telegram_id && user.telegram_id !== telegramId) {
            return NextResponse.json({ error: 'This account is already linked to a different Telegram account' }, { status: 400 });
        }

        // Validate OTP
        if (!user.otp_code || user.otp_code !== otp) {
            return NextResponse.json({ error: 'Invalid OTP code' }, { status: 400 });
        }

        // Check expiry
        if (!user.otp_expires_at || new Date() > new Date(user.otp_expires_at)) {
            return NextResponse.json({ error: 'OTP has expired. Please request a new one.' }, { status: 400 });
        }

        // Create Telegram dev wallet if not already created
        let telegramWalletAddress = user.telegram_wallet_address;
        if (!telegramWalletAddress) {
            console.log(`[Verify OTP] Creating Telegram wallet for ${user.username}...`);
            telegramWalletAddress = await createDevWallet(telegramId);
        }

        // Link Telegram ID, save Telegram wallet, clear OTP
        await sql`
            UPDATE users 
            SET telegram_id = ${telegramId}, 
                otp_code = NULL, 
                otp_expires_at = NULL,
                telegram_wallet_address = ${telegramWalletAddress}
            WHERE id = ${user.id}
        `;

        console.log(`[Verify OTP] Linked Telegram ${telegramId} to user ${user.username} | TG Wallet: ${telegramWalletAddress}`);

        return NextResponse.json({
            success: true,
            message: 'Accounts linked successfully!',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                walletAddress: user.wallet_address,        // Web Circle wallet
                telegramWalletAddress,                      // Telegram dev wallet
                walletType: user.wallet_type || 'circle',
                telegramId,
            },
            walletAddress: user.wallet_address,
            telegramWalletAddress,
        });

    } catch (error: any) {
        console.error('[Verify OTP] Error:', error.message);
        return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
    }
}
