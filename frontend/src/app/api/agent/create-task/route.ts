import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import crypto from 'crypto';

export async function POST(request: Request) {
    try {
        const { description, requesterAddress, reward } = await request.json();

        if (!description || !requesterAddress) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const taskId = crypto.randomUUID();

        // Record task in DB
        await sql`
            INSERT INTO social_payments (tx_hash, from_address, to_address, amount, memo, symbol)
            VALUES (
                ${`agent-task-${taskId}`},
                ${requesterAddress},
                ${'agent-task-pool'},
                ${reward || '0.05'},
                ${`Agent Task: ${description.substring(0, 100)}`},
                ${'USDC'}
            )
        `;

        console.log(`[Task Router] New task from ${requesterAddress}: ${description}`);

        return NextResponse.json({
            success: true,
            taskId,
            message: 'Task posted to ArcWorker network',
            reward: reward || '0.05'
        });

    } catch (error: any) {
        console.error('[Create Task] Error:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
