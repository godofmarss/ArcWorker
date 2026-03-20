import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import axios from 'axios';
import crypto from 'crypto';

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

async function getWalletId(walletAddress: string): Promise<string | null> {
    let pageAfter: string | undefined;
    do {
        const res = await devClient.get('/wallets', { params: { pageSize: 50, ...(pageAfter ? { pageAfter } : {}) } });
        const wallets = res.data.data?.wallets || [];
        const match = wallets.find((w: any) => w.address?.toLowerCase() === walletAddress.toLowerCase());
        if (match) return match.id;
        pageAfter = res.data.data?.pageAfter;
    } while (pageAfter);
    return null;
}

export async function POST(request: Request) {
    try {
        const { query, walletAddress, walletType } = await request.json();

        if (!query || !walletAddress) {
            return NextResponse.json({ error: 'Missing query or walletAddress' }, { status: 400 });
        }

        const PRICE = '0.01'; // $0.01 USDC per query
        const AGENT_WALLET = process.env.X402_AGENT_WALLET || '0x4435ff7d8066a8f83af26fbb9434793f73ddb6e0';
        const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || '').replace(/['"]+/g, '').trim();

        // Deduct payment from user wallet (dev_circle - server side)
        if (walletType === 'dev_circle' || walletType === 'circle') {
            const walletId = await getWalletId(walletAddress);
            if (!walletId) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });

            const ciphertext = await generateCiphertext(entitySecret);

            // Transfer $0.01 USDC from user to agent wallet
            await devClient.post('/developer/transactions/transfer', {
                idempotencyKey: crypto.randomUUID(),
                entitySecretCiphertext: ciphertext,
                walletId,
                destinationAddress: AGENT_WALLET,
                amounts: [PRICE],
                feeLevel: 'HIGH',
                tokenAddress: '0x3600000000000000000000000000000000000000',
                blockchain: 'ARC-TESTNET',
            });
        }

        // Call AI
        const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: 'You are ArcWorker Agent, a helpful AI assistant for the ArcWorker platform. Be concise, helpful and accurate.' },
                    { role: 'user', content: query }
                ],
                max_tokens: 500
            })
        });

        const data = await aiResponse.json();
        const answer = data.choices?.[0]?.message?.content || 'No response generated';

        console.log(`[Agent] Query from ${walletAddress}: "${query}" | Cost: $${PRICE}`);

        return NextResponse.json({
            success: true,
            answer,
            cost: PRICE,
            query
        });

    } catch (error: any) {
        console.error('[Agent] Error:', error.response?.data || error.message);
        return NextResponse.json({ error: 'Agent query failed', details: error.message }, { status: 500 });
    }
}
