import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import axios from 'axios';
import crypto from 'crypto';

const AGENT_WALLET = process.env.X402_AGENT_WALLET || '0x4435ff7d8066a8f83af26fbb9434793f73ddb6e0';
const TASK_ESCROW = '0x43AE98Ff8A2af37855C0209F4470e849B75cBE0F';
const REWARD_PER_TASK = '50000000000000000'; // 0.05 USDC in 18 decimals

const devClient = axios.create({
    baseURL: 'https://api.circle.com/v1/w3s',
    headers: { 'Content-Type': 'application/json' },
});

devClient.interceptors.request.use((config) => {
    const key = (process.env.CIRCLE_TELEGRAM_API_KEY || process.env.CIRCLE_API_KEY || '').replace(/['"]+/g, '').trim();
    config.headers['Authorization'] = `Bearer ${key}`;
    return config;
});

async function generateCiphertext(entitySecret: string): Promise<string> {
    const pubKeyRes = await devClient.get('/config/entity/publicKey');
    const encrypted = crypto.publicEncrypt(
        { key: pubKeyRes.data.data.publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(entitySecret, 'hex')
    );
    return encrypted.toString('base64');
}

async function getAgentWalletId(): Promise<string | null> {
    let pageAfter: string | undefined;
    do {
        const res = await devClient.get('/wallets', { params: { pageSize: 50, ...(pageAfter ? { pageAfter } : {}) } });
        const wallets = res.data.data?.wallets || [];
        const match = wallets.find((w: any) => w.address?.toLowerCase() === AGENT_WALLET.toLowerCase());
        if (match) return match.id;
        pageAfter = res.data.data?.pageAfter;
    } while (pageAfter);
    return null;
}

export async function POST(request: Request) {
    try {
        const { description, requesterAddress, reward } = await request.json();

        if (!description || !requesterAddress) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || '').replace(/['"]+/g, '').trim();
        if (!entitySecret) {
            return NextResponse.json({ error: 'Entity secret not configured' }, { status: 500 });
        }

        // Get agent wallet ID
        const walletId = await getAgentWalletId();
        if (!walletId) {
            return NextResponse.json({ error: 'Agent wallet not found' }, { status: 404 });
        }

        // Build task metadata
        const taskId = crypto.randomUUID();
        const deadline = Math.floor(Date.now() / 1000) + 86400 * 3; // 3 days from now
        const metadata = JSON.stringify({
            title: description.substring(0, 80),
            desc: description,
            tmpl: 'survey',
            tags: ['Agent', 'Task'],
            timePerTaskSec: 120,
            requester: requesterAddress,
            agentTaskId: taskId,
        });

        const rewardAmount = REWARD_PER_TASK;
        const count = 1;
        const requiredSubmissions = 1;
        const correctAnswerHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

        // Total deposit needed = reward * count + platform fee
        // Platform fee is 500 BPS (5%) of reward
        const platformFee = Math.floor(Number(rewardAmount) * 500 / 10000);
        const totalDeposit = (Number(rewardAmount) * count + platformFee).toString();

        console.log(`[Agent Task] Creating on-chain task: "${description.substring(0, 50)}" | Deposit: ${totalDeposit}`);

        // Call createTasksBatch on-chain via Circle dev wallet
        const ciphertext = await generateCiphertext(entitySecret);

        const txRes = await devClient.post('/developer/transactions/contractExecution', {
            idempotencyKey: crypto.randomUUID(),
            entitySecretCiphertext: ciphertext,
            walletId,
            contractAddress: TASK_ESCROW,
            abiFunctionSignature: 'createTasksBatch(uint256,uint256,uint256,string,uint256,bytes32)',
            abiParameters: [
                rewardAmount,
                count.toString(),
                deadline.toString(),
                metadata,
                requiredSubmissions.toString(),
                correctAnswerHash
            ],
            feeLevel: 'HIGH',
            amount: totalDeposit, // native token deposit
        });

        const transactionId = txRes.data.data?.id;
        console.log(`[Agent Task] On-chain task submitted: ${transactionId}`);

        // Record in DB for tracking
        await sql`
            INSERT INTO social_payments (tx_hash, from_address, to_address, amount, memo, symbol)
            VALUES (
                ${`agent-task-${taskId}`},
                ${requesterAddress},
                ${AGENT_WALLET},
                ${reward || '0.05'},
                ${`Agent Task Created: ${description.substring(0, 80)}`},
                ${'USDC'}
            )
        `.catch(() => {});

        return NextResponse.json({
            success: true,
            taskId,
            transactionId,
            message: 'Task posted to ArcWorker network',
            reward: reward || '0.05',
            deadline: new Date(deadline * 1000).toISOString(),
        });

    } catch (error: any) {
        const errData = error.response?.data || error.message;
        console.error('[Create Task] Error:', JSON.stringify(errData, null, 2));
        return NextResponse.json({ 
            error: 'Failed to create on-chain task',
            details: typeof errData === 'string' ? errData : JSON.stringify(errData)
        }, { status: 500 });
    }
}
