import { NextResponse } from 'next/server';
import axios from 'axios';
import crypto from 'crypto';

const AGENT_WALLET = process.env.X402_AGENT_WALLET || '0x4435ff7d8066a8f83af26fbb9434793f73ddb6e0';
const TASK_ESCROW = '0x43AE98Ff8A2af37855C0209F4470e849B75cBE0F';
const RPC_URL = 'https://rpc.arc-testnet.com'; // Arc testnet RPC

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

// Read tasks from chain via RPC
async function getAvailableTasks(): Promise<any[]> {
    try {
        // Call getRecentTasks(50) via eth_call
        const getRecentTasksSelector = '0x7bed78a8'; // getRecentTasks(uint256)
        const encodedParam = BigInt(50).toString(16).padStart(64, '0');
        
        const response = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_call',
                params: [{
                    to: TASK_ESCROW,
                    data: `${getRecentTasksSelector}${encodedParam}`
                }, 'latest'],
                id: 1
            })
        });

        const data = await response.json();
        if (data.error) {
            console.error('[Scan] RPC error:', data.error);
            return [];
        }

        // For now return empty - we'll use the API endpoint instead
        return [];
    } catch (e: any) {
        console.error('[Scan] Failed to fetch tasks from chain:', e.message);
        return [];
    }
}

// Fetch tasks from our own API (which already reads from chain)
async function fetchTasksFromAPI(): Promise<any[]> {
    try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_URL}/api/tasks/available`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.tasks || [];
    } catch (e) {
        return [];
    }
}

// Use AI to solve a task based on its metadata
async function solveTask(task: any): Promise<string | null> {
    try {
        const metadata = task.metadata || {};
        const moduleId = metadata.tmpl || metadata.moduleId || 'survey';
        const description = metadata.desc || task.description || 'Complete this task';
        const options = metadata.options || [];
        const title = metadata.title || task.title || 'Task';

        let prompt = '';

        if (options.length > 0) {
            // Multiple choice task
            prompt = `You are completing a task for ArcWorker. 
Task: "${title}"
Description: "${description}"
Available options: ${options.join(', ')}

Choose the BEST option from the list. Reply with ONLY the option text, nothing else.`;
        } else if (moduleId === 'nlp-sentiment' || moduleId === 'text-classification') {
            prompt = `Analyze this text and classify it.
Task: "${title}"  
Content: "${description}"
Reply with a single word classification.`;
        } else if (moduleId === 'nlp-trans') {
            prompt = `Translate the following text as requested.
Task: "${title}"
Content: "${description}"
Reply with only the translation.`;
        } else if (moduleId === 'survey') {
            prompt = `You are completing a survey task.
Question: "${title}"
Details: "${description}"
${options.length > 0 ? `Options: ${options.join(', ')}` : ''}
Provide a clear, concise answer.`;
        } else {
            // Generic task
            prompt = `Complete this task accurately and concisely.
Task: "${title}"
Description: "${description}"
${options.length > 0 ? `Options to choose from: ${options.join(', ')}` : ''}
Reply with your answer only.`;
        }

        const aiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: 'You are an AI worker completing tasks accurately. Always give direct, concise answers.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 200,
                temperature: 0.3
            })
        });

        const aiData = await aiRes.json();
        const answer = aiData.choices?.[0]?.message?.content?.trim();
        
        // If options exist, make sure answer matches one of them
        if (options.length > 0 && answer) {
            const matchedOption = options.find((opt: string) => 
                answer.toLowerCase().includes(opt.toLowerCase()) || 
                opt.toLowerCase().includes(answer.toLowerCase())
            );
            return matchedOption || options[0]; // fallback to first option
        }

        return answer || null;
    } catch (e: any) {
        console.error('[Scan] AI solve failed:', e.message);
        return null;
    }
}

// Submit task answer on-chain
async function submitTaskOnChain(walletId: string, taskId: number, answer: string): Promise<string | null> {
    try {
        const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || '').replace(/['"]+/g, '').trim();
        const ciphertext = await generateCiphertext(entitySecret);

        const txRes = await devClient.post('/developer/transactions/contractExecution', {
            idempotencyKey: crypto.randomUUID(),
            entitySecretCiphertext: ciphertext,
            walletId,
            contractAddress: TASK_ESCROW,
            abiFunctionSignature: 'submitTask(uint256,string)',
            abiParameters: [taskId.toString(), answer],
            feeLevel: 'HIGH',
        });

        const transactionId = txRes.data.data?.id;
        console.log(`[Scan] Task ${taskId} submitted: ${transactionId} | Answer: "${answer.substring(0, 50)}"`);
        return transactionId;
    } catch (e: any) {
        console.error(`[Scan] Failed to submit task ${taskId}:`, e.response?.data || e.message);
        return null;
    }
}

export async function GET(request: Request) {
    try {
        console.log('[Scan] Starting agent task scan...');

        const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || '').replace(/['"]+/g, '').trim();
        if (!entitySecret) {
            return NextResponse.json({ error: 'Entity secret not configured' }, { status: 500 });
        }

        // Get agent wallet
        const walletId = await getAgentWalletId();
        if (!walletId) {
            return NextResponse.json({ error: 'Agent wallet not found' }, { status: 404 });
        }

        // Fetch available tasks
        const tasks = await fetchTasksFromAPI();
        
        if (!tasks || tasks.length === 0) {
            console.log('[Scan] No available tasks found');
            return NextResponse.json({ success: true, message: 'No tasks available', completed: 0 });
        }

        const now = Math.floor(Date.now() / 1000);
        
        // Filter eligible tasks
        const eligible = tasks.filter((t: any) => {
            const status = Number(t.status);
            const deadline = Number(t.deadline);
            const currentSubs = Number(t.currentSubmissions);
            const requiredSubs = Number(t.requiredSubmissions);
            const agency = t.agency?.toLowerCase();
            
            return status === 0 && // Open
                   deadline > now && // Not expired
                   currentSubs < requiredSubs && // Still needs submissions
                   agency !== AGENT_WALLET.toLowerCase(); // Don't do own tasks
        });

        console.log(`[Scan] Found ${eligible.length} eligible tasks out of ${tasks.length} total`);

        if (eligible.length === 0) {
            return NextResponse.json({ success: true, message: 'No eligible tasks', completed: 0 });
        }

        // Process up to 3 tasks per run to avoid timeout
        const toProcess = eligible.slice(0, 3);
        const results = [];

        for (const task of toProcess) {
            console.log(`[Scan] Processing task ${task.id}: "${task.title}"`);
            
            const answer = await solveTask(task);
            if (!answer) {
                console.log(`[Scan] Could not solve task ${task.id}`);
                results.push({ taskId: task.id, status: 'skipped', reason: 'Could not generate answer' });
                continue;
            }

            const txId = await submitTaskOnChain(walletId, task.id, answer);
            results.push({ 
                taskId: task.id, 
                status: txId ? 'submitted' : 'failed',
                transactionId: txId,
                answer: answer.substring(0, 50)
            });

            // Small delay between submissions
            await new Promise(r => setTimeout(r, 1000));
        }

        const submitted = results.filter(r => r.status === 'submitted').length;
        console.log(`[Scan] Complete. Submitted: ${submitted}/${toProcess.length}`);

        return NextResponse.json({ 
            success: true, 
            completed: submitted,
            total: toProcess.length,
            results 
        });

    } catch (error: any) {
        console.error('[Scan] Error:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// Also support POST for manual triggering
export async function POST(request: Request) {
    return GET(request);
}
