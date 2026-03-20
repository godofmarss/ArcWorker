import { NextResponse } from 'next/server';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = 'https://arc-worker-neon.vercel.app';

async function sendMessage(chatId: number, text: string, replyMarkup?: any) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
            reply_markup: replyMarkup,
        }),
    });
}

async function answerCallback(callbackQueryId: string) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // --- Handle button taps ---
        if (body.callback_query) {
            const callbackQuery = body.callback_query;
            const chatId = callbackQuery.message.chat.id;
            const data = callbackQuery.data;

            await answerCallback(callbackQuery.id);

            if (data === 'start_earning') {
                await sendMessage(chatId,
                    `*Let's get you earning!*\n\nComplete simple AI tasks — surveys, labeling, reviews — and get paid instantly in *USDC* to your wallet.\n\nNo KYC. No delays. Just work and earn.`,
                    {
                        inline_keyboard: [[
                            { text: 'Open ArcWorker', web_app: { url: APP_URL } }
                        ]]
                    }
                );
            }

            if (data === 'learn_more') {
                await sendMessage(chatId,
                    `*How ArcWorker works:*\n\n1. Open the app\n2. Pick a task — surveys, AI labeling, reviews\n3. Submit your answer\n4. Get paid instantly in *USDC*\n\nYour wallet is created automatically. Powered by Circle & blockchain escrow.`,
                    {
                        inline_keyboard: [[
                            { text: 'Start Earning Now', web_app: { url: APP_URL } }
                        ]]
                    }
                );
            }

            return NextResponse.json({ ok: true });
        }

        // --- Handle text messages ---
        const message = body.message;
        if (!message) return NextResponse.json({ ok: true });

        const chatId = message.chat.id;
        const text = message.text || '';
        const firstName = message.from?.first_name || 'there';

        if (text === '/start') {
            await sendMessage(chatId,
                `Hey *${firstName}*, welcome to *ArcWorker*.\n\nEarn USDC by completing tasks, or ask the agent anything.\n\nType /help to see what I can do.`,
                {
                    inline_keyboard: [[
                        { text: '💰 Yes, Let\'s Go!', callback_data: 'start_earning' },
                        { text: '📖 Learn More', callback_data: 'learn_more' },
                    ]]
                }
            );

        } else if (text === '/help') {
            await sendMessage(chatId,
                `*ArcWorker Commands*\n\n/start — Welcome screen\n/app — Open ArcWorker\n/balance — Check your wallet\n/help — Show this menu\n\nOr just type any message and the agent will respond.\n\n_Each query costs $0.0001 USDC._`
            );

        } else if (text === '/app') {
            await sendMessage(chatId,
                `Open ArcWorker:`,
                {
                    inline_keyboard: [[
                        { text: 'Open ArcWorker', web_app: { url: APP_URL } }
                    ]]
                }
            );

        } else if (text === '/balance') {
            const userResult = await fetch(`${process.env.NEXT_PUBLIC_URL}/api/auth/telegram-lookup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telegramId: String(message.from.id) })
            }).then(r => r.json());

            if (!userResult.walletAddress) {
                await sendMessage(chatId, 'No wallet found. Open the ArcWorker app first.');
            } else {
                await sendMessage(chatId, `Your wallet:\n\`${userResult.walletAddress}\`\n\nOpen the app to see your full balance.`, {
                    inline_keyboard: [[{ text: 'Open Wallet', web_app: { url: APP_URL } }]]
                });
            }

        } else if (text && !text.startsWith('/') && text.trim().length <= 10) {
            // Short messages — free response
            await sendMessage(chatId, `Hey ${firstName}! Ask me anything and I'll help.\n\nEach query costs $0.0001 USDC. Type /help to see all commands.`);

        } else if (text && !text.startsWith('/') && text.trim().length > 10) {
            // Agent query
            const userResult = await fetch(`${process.env.NEXT_PUBLIC_URL}/api/auth/telegram-lookup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telegramId: String(message.from.id) })
            }).then(r => r.json());

            if (!userResult.walletAddress) {
                await sendMessage(chatId, 'No wallet found. Please open the ArcWorker app first to set up your wallet.');
            } else {
                await sendMessage(chatId, '_Processing..._');

                const agentRes = await fetch(`${process.env.NEXT_PUBLIC_URL}/api/agent/pay-and-query`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: text,
                        walletAddress: userResult.walletAddress,
                        walletType: userResult.walletType
                    })
                }).then(r => r.json());

                if (agentRes.error) {
                    await sendMessage(chatId, `Error: ${agentRes.error}`);
                } else {
                    await sendMessage(chatId, `*ArcWorker Agent*\n\n${agentRes.answer}\n\n_$${agentRes.cost} USDC deducted_`);
                }
            }
        }

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.error('[Telegram Webhook] Error:', e.message);
        return NextResponse.json({ ok: true });
    }
}

export async function GET() {
    return NextResponse.json({ ok: true, message: 'ArcWorker bot webhook active' });
}
