import { NextResponse } from 'next/server';
import { getUserByEmailOrUsername, createUser } from '@/utils/db';
import { getOrCreateCircleUser, createCircleSession, findFundedWallet } from '@/arcworker-sdk/wallet/server';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { telegramId, telegramUsername, telegramName, initData } = body;

        if (!telegramId) {
            return NextResponse.json({ error: 'Missing Telegram ID' }, { status: 400 });
        }

        // Use telegram ID as the unique identifier
        const syntheticEmail = `tg_${telegramId}@telegram.arcworker`;
        const username = telegramUsername || `tg_${telegramId}`;
        const displayName = telegramName || username;

        // Check if user already exists
        let existingUser = await getUserByEmailOrUsername(syntheticEmail)
            .catch(() => null);

        if (!existingUser) {
            // Try by username too
            existingUser = await getUserByEmailOrUsername(username).catch(() => null);
        }

        if (existingUser) {
            // --- EXISTING USER: LOGIN ---
            console.log(`[Telegram Auth] Existing user login: ${username} (${existingUser.role})`);

            // Get or create Circle session
            const userId = existingUser.user_id || existingUser.userId || syntheticEmail;
            let circleSession = null;
            let walletAddress = existingUser.wallet_address || existingUser.walletAddress;

            try {
                const circleUser = await getOrCreateCircleUser(userId);
                const session = await createCircleSession(circleUser.userId);
                circleSession = session;

                // Try to get wallet address if not stored
                if (!walletAddress) {
                    const walletResult = await findFundedWallet(session.userToken, '0').catch(() => null);
                    walletAddress = walletResult?.wallet?.address || walletAddress;
                }
            } catch (e) {
                console.warn('[Telegram Auth] Circle session error (non-fatal):', e);
            }

            return NextResponse.json({
                success: true,
                isNewUser: false,
                user: {
                    username: existingUser.username,
                    name: displayName,
                    role: existingUser.role || 'worker',
                    walletType: 'circle',
                    email: syntheticEmail,
                    id: existingUser.user_id || existingUser.userId || syntheticEmail,
                    userId: existingUser.user_id || existingUser.userId || syntheticEmail,
                    walletAddress,
                    telegramId,
                    telegramUsername: username,
                },
                circleSession: circleSession ? {
                    userToken: circleSession.userToken,
                    encryptionKey: circleSession.encryptionKey,
                } : null,
                walletAddress,
            });
        }

        // --- NEW USER: REGISTER ---
        console.log(`[Telegram Auth] New user registration: ${username}`);

        // Create Circle wallet
        let circleUserId = syntheticEmail;
        let circleSession = null;
        let walletAddress = null;

        try {
            const circleUser = await getOrCreateCircleUser(syntheticEmail);
            circleUserId = circleUser.userId;
            const session = await createCircleSession(circleUserId);
            circleSession = session;

            // Try to get wallet address
            const walletResult = await findFundedWallet(session.userToken, '0').catch(() => null);
            walletAddress = walletResult?.wallet?.address || null;
        } catch (e) {
            console.warn('[Telegram Auth] Circle wallet creation error (non-fatal):', e);
        }

        // Save user to DB
        await createUser({
            username,
            password: `tg_${telegramId}_${Date.now()}`, // non-usable password
            email: syntheticEmail,
            walletAddress: walletAddress || '',
            role: 'worker', // Telegram users are always workers
            walletType: 'circle',
            userId: circleUserId,
        });

        console.log(`[Telegram Auth] New user registered: ${username} | Circle: ${circleUserId}`);

        return NextResponse.json({
            success: true,
            isNewUser: true,
            user: {
                username,
                name: displayName,
                role: 'worker',
                walletType: 'circle',
                email: syntheticEmail,
                id: circleUserId,
                userId: circleUserId,
                walletAddress,
                telegramId,
                telegramUsername: username,
            },
            circleSession: circleSession ? {
                userToken: circleSession.userToken,
                encryptionKey: circleSession.encryptionKey,
            } : null,
            walletAddress,
        });

    } catch (error: any) {
        console.error('[Telegram Auth] CRITICAL ERROR:', error.message);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
