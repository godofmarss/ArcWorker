import { NextResponse } from 'next/server';
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

function detectQueryType(query: string): { type: string; price: string } {
    const q = query.toLowerCase();
    if (q.match(/price|market|coin|crypto|bitcoin|btc|eth|usdc|token|trading|chart|volume|cap/)) {
        return { type: 'market_data', price: '0.0001' };
    }
    if (q.match(/research|find|search|news|latest|recent|what happened|tell me about|analyze|report/)) {
        return { type: 'research', price: '0.0005' };
    }
    if (q.match(/complete|do this|task|survey|label|annotate|transcribe|translate|classify/)) {
        return { type: 'task_routing', price: '0.001' };
    }
    return { type: 'ai_query', price: '0.0001' };
}

async function fetchMarketData(query: string): Promise<string> {
    const q = query.toLowerCase();
    const coinMap: Record<string, string> = {
        'bitcoin': 'bitcoin', 'btc': 'bitcoin',
        'ethereum': 'ethereum', 'eth': 'ethereum',
        'solana': 'solana', 'sol': 'solana',
        'usdc': 'usd-coin', 'bnb': 'binancecoin',
        'cardano': 'cardano', 'ada': 'cardano',
        'xrp': 'ripple', 'ripple': 'ripple',
        'doge': 'dogecoin', 'dogecoin': 'dogecoin',
    };
    let coinId = 'bitcoin';
    for (const [key, value] of Object.entries(coinMap)) {
        if (q.includes(key)) { coinId = value; break; }
    }
    try {
        const res = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
            { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY || '' } }
        );
        const data = await res.json();
        const coin = data[coinId];
        if (!coin) return 'Could not fetch price data for that coin.';
        const change = coin.usd_24h_change?.toFixed(2);
        const direction = parseFloat(change) >= 0 ? 'up' : 'down';
        return `*${coinId.charAt(0).toUpperCase() + coinId.slice(1)} Price*\n\nPrice: $${coin.usd?.toLocaleString()}\n24h Change: ${direction} ${change}%\nMarket Cap: $${(coin.usd_market_cap / 1e9).toFixed(2)}B`;
    } catch (e) {
        return 'Failed to fetch market data. Please try again.';
    }
}

async function fetchResearch(query: string): Promise<string> {
    try {
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: process.env.TAVILY_API_KEY,
                query,
                search_depth: 'basic',
                max_results: 3,
                include_answer: true
            })
        });
        const data = await res.json();
        if (data.answer) return `*Research Result*\n\n${data.answer}`;
        if (data.results?.length > 0) return `*Research Result*\n\n${data.results[0].content?.substring(0, 500)}...`;
        return 'No results found for your query.';
    } catch (e) {
        return 'Research failed. Please try again.';
    }
}

async function routeTask(query: string, requesterAddress: string): Promise<string> {
    try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_URL}/api/agent/create-task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: query, requesterAddress, reward: '0.05' })
        });
        const data = await res.json();
        if (data.success) {
            return `*Task Created*\n\nYour task has been posted to ArcWorker workers.\n\nTask ID: ${data.taskId}\nReward: $0.05 USDC per completion\n\nYou will be notified when it is completed.`;
        }
        return 'Task routing failed. Please try again.';
    } catch (e) {
        return 'Could not route task. Please try again.';
    }
}

async function callSpecialistAgent(query: string, agentType: string): Promise<string> {
    const systemPrompts: Record<string, string> = {
        research: 'You are a research specialist. Provide detailed, accurate research.',
        trading: 'You are a trading analyst. Provide concise market analysis and trading insights.',
        writing: 'You are a content writer. Write clear, engaging content.',
        coding: 'You are a coding expert. Provide clean, well-commented code solutions.',
    };
    const systemPrompt = systemPrompts[agentType] || 'You are ArcWorker Agent, a helpful AI assistant for the ArcWorker platform. Be concise and useful.';
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: query }
            ],
            max_tokens: 600
        })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'No response from specialist agent.';
}

export async function POST(request: Request) {
    try {
        const { query, walletAddress, walletType } = await request.json();

        if (!query || !walletAddress) {
            return NextResponse.json({ error: 'Missing query or walletAddress' }, { status: 400 });
        }

        const AGENT_WALLET = process.env.X402_AGENT_WALLET || '0x4435ff7d8066a8f83af26fbb9434793f73ddb6e0';
        const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || '').replace(/['"]+/g, '').trim();

        const { type, price: PRICE } = detectQueryType(query);

        const walletId = await getWalletId(walletAddress);
        if (!walletId) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });

        const balanceRes = await devClient.get(`/wallets/${walletId}/balances`);
        const balances = balanceRes.data.data?.tokenBalances || [];
        const usdcBalance = balances.find((b: any) => b.token?.symbol === 'USDC' || b.token?.isNative);
        const currentBalance = parseFloat(usdcBalance?.amount || '0');

        if (currentBalance < parseFloat(PRICE)) {
            return NextResponse.json({
                error: `Insufficient balance. Need $${PRICE} USDC, you have $${currentBalance.toFixed(4)} USDC.`
            }, { status: 400 });
        }

        const ciphertext = await generateCiphertext(entitySecret);
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

        let answer = '';
        let agentUsed = 'ArcWorker Agent';

        if (type === 'market_data') {
            answer = await fetchMarketData(query);
            agentUsed = 'Market Data Agent';
        } else if (type === 'research') {
            answer = await fetchResearch(query);
            agentUsed = 'Research Agent';
        } else if (type === 'task_routing') {
            answer = await routeTask(query, walletAddress);
            agentUsed = 'Task Router';
        } else {
            const q = query.toLowerCase();
            const agentType = q.match(/trade|market|invest|stock/) ? 'trading' :
                             q.match(/write|content|post|tweet/) ? 'writing' :
                             q.match(/code|program|bug|function/) ? 'coding' : 'research';
            answer = await callSpecialistAgent(query, agentType);
            agentUsed = agentType.charAt(0).toUpperCase() + agentType.slice(1) + ' Agent';
        }

        await fetch(`${process.env.NEXT_PUBLIC_URL}/api/social/payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fromAddress: walletAddress,
                toAddress: AGENT_WALLET,
                amount: PRICE,
                symbol: 'USDC',
                memo: `${agentUsed}: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`,
            })
        }).catch(() => {});

        console.log(`[Agent] ${agentUsed} — "${query}" | $${PRICE} | ${walletAddress}`);

        return NextResponse.json({
            success: true,
            answer,
            cost: PRICE,
            agentUsed,
            type,
            query
        });

    } catch (error: any) {
        console.error('[Agent] Error:', error.response?.data || error.message);
        return NextResponse.json({ error: 'Agent query failed', details: error.message }, { status: 500 });
    }
}
