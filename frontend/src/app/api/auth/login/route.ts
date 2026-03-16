import { NextResponse } from 'next/server';
import { getUserByEmailOrUsername } from '@/utils/db';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { email, password, role: requestedRole } = body;
        console.log(`[Auth Login] Attempt for: ${email} as ${requestedRole || 'unknown'}`);
        const user = await getUserByEmailOrUsername(email);
        if (!user) {
            console.warn(`[Auth Login] User NOT FOUND: ${email}`);
            return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
        }
        if (user.password !== password) {
            console.warn(`[Auth Login] WRONG PASSWORD for: ${email}`);
            return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
        }
        if (requestedRole && user.role !== requestedRole) {
            console.warn(`[Auth Login] ROLE MISMATCH for ${email}: Expected ${user.role}, got ${requestedRole}`);
            return NextResponse.json({
                error: `Invalid portal. This account is registered as ${user.role.toUpperCase()}.`
            }, { status: 403 });
        }
        console.log(`[Auth Login] SUCCESS: ${user.username} (${user.role})`);
        return NextResponse.json({
            success: true,
            user: {
                username: user.username,
                name: user.username,
                role: user.role,
                walletAddress: user.wallet_address || user.walletAddress,
                email: user.email,
                walletType: user.wallet_type || user.walletType || 'circle',
                id: user.user_id || user.userId || user.id || user.email,
                userId: user.user_id || user.userId,
                telegramWalletAddress: user.telegram_wallet_address || null,
            }
        });
    } catch (error: any) {
        console.error('[Auth Login] CRITICAL ERROR:', error.message);
        return NextResponse.json({ error: 'Internal server error during login' }, { status: 500 });
    }
}
