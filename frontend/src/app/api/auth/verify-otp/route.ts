import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function POST(request: Request) {
    try {
        const { email, otp, telegramId, telegramUsername } = await request.json();

        if (!email || !otp || !telegramId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Find user and check OTP
        const result = await sql`
            SELECT id, username, email, role, wallet_address, wallet_type, otp_code, otp_expires_at, telegram_id
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

        // Link Telegram ID and clear OTP
        await sql`
            UPDATE users 
            SET telegram_id = ${telegramId}, 
                otp_code = NULL, 
                otp_expires_at = NULL
            WHERE id = ${user.id}
        `;

        console.log(`[Verify OTP] Linked Telegram ${telegramId} to user ${user.username}`);

        // Create Circle session for the linked user
let circleSession = null;
try {
    const { createCircleSession } = await import('@/arcworker-sdk/wallet/server');
    circleSession = await createCircleSession(user.id);
} catch (e) {
    console.error('[Verify OTP] Could not create Circle session:', e);
}

return NextResponse.json({
    success: true,
    message: 'Accounts linked successfully!',
    user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        walletAddress: user.wallet_address,
        walletType: user.wallet_type || 'circle',
        telegramId,
    },
    circleSession,
    walletAddress: user.wallet_address,
});

    } catch (error: any) {
        console.error('[Verify OTP] Error:', error.message);
        return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
    }
}
