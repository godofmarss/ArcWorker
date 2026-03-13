import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: Request) {
    try {
        const { email } = await request.json();

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        // Check if user exists
        const result = await sql`SELECT id, username FROM users WHERE email = ${email.toLowerCase()}`;
        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'No account found with this email' }, { status: 404 });
        }

        const user = result.rows[0];
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Save OTP to DB
        await sql`UPDATE users SET otp_code = ${otp}, otp_expires_at = ${expiresAt.toISOString()} WHERE id = ${user.id}`;

        // Send OTP email
        await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
            to: email,
            subject: 'ArcWorker - Link Your Telegram Account',
            html: `
                <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0a0a0f; color: #fff; border-radius: 16px;">
                    <h2 style="color: #3b82f6; margin-bottom: 8px;">ArcWorker</h2>
                    <p style="color: #94a3b8;">Hi <strong>${user.username}</strong>,</p>
                    <p style="color: #94a3b8;">Use this code to link your Telegram account:</p>
                    <div style="background: #1e293b; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                        <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #3b82f6;">${otp}</span>
                    </div>
                    <p style="color: #64748b; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
                </div>
            `
        });

        console.log(`[Send OTP] Sent to ${email} for user ${user.username}`);
        return NextResponse.json({ success: true, message: 'OTP sent to your email' });

    } catch (error: any) {
        console.error('[Send OTP] Error:', error.message);
        return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 });
    }
}
