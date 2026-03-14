import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { createCircleSession } from '@/arcworker-sdk/wallet/server';

export async function POST(request: Request) {
    try {
        const { email, otp } = await request.json();

        if (!email || !otp) {
            return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
        }

        const result = await sql`
            SELECT id, username, otp_code, otp_expires_at
            FROM users WHERE email = ${email.toLowerCase()}
        `;

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const user = result.rows[0];

        if (!user.otp_code || user.otp_code !== otp) {
            return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
        }

        if (!user.otp_expires_at || new Date() > new Date(user.otp_expires_at)) {
            return NextResponse.json({ error: 'Code expired' }, { status: 400 });
        }

        await sql`UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = ${user.id}`;

        const session = await createCircleSession(user.id);

        console.log(`[ReAuth Session] Created session for ${user.username}`);

        return NextResponse.json({
            success: true,
            userToken: session.userToken,
            encryptionKey: session.encryptionKey,
        });

    } catch (error: any) {
        console.error('[ReAuth Session] Error:', error.message);
        return NextResponse.json({ error: 'Session creation failed' }, { status: 500 });
    }
}
