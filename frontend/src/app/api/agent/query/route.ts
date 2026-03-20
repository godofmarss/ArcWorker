import { NextResponse } from 'next/server';

const PRICE_PER_QUERY = '0.01'; // $0.01 USDC per query
const AGENT_WALLET = process.env.X402_AGENT_WALLET || '0x4435ff7d8066a8f83af26fbb9434793f73ddb6e0';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const paymentHeader = request.headers.get('x-payment');

    // No payment header — return 402 with payment instructions
    if (!paymentHeader) {
        return NextResponse.json({
            error: 'Payment Required',
            x402: {
                x402Version: 1,
                accepts: [{
                    scheme: 'exact',
                    network: 'arc-testnet',
                    asset: '0x3600000000000000000000000000000000000000',
                    payTo: AGENT_WALLET,
                    maxAmountRequired: '10000000000000000', // 0.01 USDC in 18 decimals
                    resource: '/api/agent/query',
                    description: 'ArcWorker Agent query',
                    mimeType: 'application/json',
                    maxTimeoutSeconds: 300,
                    extra: { name: 'USDC', version: '2' }
                }],
                error: 'Payment required for agent query'
            }
        }, { status: 402 });
    }

    // Payment header present — verify and respond
    if (!query) {
        return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 });
    }

    // Call AI (Groq)
    try {
        const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: 'You are ArcWorker Agent, a helpful AI assistant. Be concise and useful.' },
                    { role: 'user', content: query }
                ],
                max_tokens: 500
            })
        });

        const data = await aiResponse.json();
        const answer = data.choices?.[0]?.message?.content || 'No response generated';

        return NextResponse.json({
            success: true,
            query,
            answer,
            cost: PRICE_PER_QUERY,
            paidTo: AGENT_WALLET
        }, {
            headers: {
                'X-PAYMENT-RESPONSE': 'settled'
            }
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const paymentHeader = request.headers.get('x-payment');
    const body = await request.json();
    const { query } = body;

    if (!paymentHeader) {
        return NextResponse.json({
            error: 'Payment Required',
            x402: {
                x402Version: 1,
                accepts: [{
                    scheme: 'exact',
                    network: 'arc-testnet',
                    asset: '0x3600000000000000000000000000000000000000',
                    payTo: AGENT_WALLET,
                    maxAmountRequired: '10000000000000000',
                    resource: '/api/agent/query',
                    description: 'ArcWorker Agent query',
                    mimeType: 'application/json',
                    maxTimeoutSeconds: 300,
                    extra: { name: 'USDC', version: '2' }
                }],
                error: 'Payment required for agent query'
            }
        }, { status: 402 });
    }

    if (!query) {
        return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    try {
        const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: 'You are ArcWorker Agent, a helpful AI assistant. Be concise and useful.' },
                    { role: 'user', content: query }
                ],
                max_tokens: 500
            })
        });

        const data = await aiResponse.json();
        const answer = data.choices?.[0]?.message?.content || 'No response generated';

        return NextResponse.json({
            success: true,
            query,
            answer,
            cost: PRICE_PER_QUERY,
            paidTo: AGENT_WALLET
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
