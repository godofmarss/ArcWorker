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
                    `🚀 *Let's get you earning!*\n\nComplete simple AI tasks — surveys, labeling, reviews — and get paid instantly in *USDC* to your wallet.\n\n⚡ No KYC. No delays. Just work and earn.`,
                    {
                        inline_keyboard: [[
                            { text: '🎯 Open ArcWorker', web_app: { url: APP_URL } }
                        ]]
                    }
                );
            }

            if (data === 'learn_more') {
                await sendMessage(chatId,
                    `📖 *How ArcWorker works:*\n\n1️⃣ Open the app\n2️⃣ Pick a task — surveys, AI labeling, reviews\n3️⃣ Submit your answer\n4️⃣ Get paid instantly in *USDC*\n\n💼 Your wallet is created automatically — no setup needed.\n🔒 Powered by Circle & blockchain escrow.`,
                    {
                        inline_keyboard: [[
                            { text: '💰 Start Earning Now', web_app: { url: APP_URL } }
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
                `👋 Hey *${firstName}*! Welcome to *ArcWorker*.\n\nWould you like to earn some *USDC* today?`,
                {
                    inline_keyboard: [[
                        { text: '💰 Yes, Let\'s Go!', callback_data: 'start_earning' },
                        { text: '📖 Learn More', callback_data: 'learn_more' },
                    ]]
                }
            );
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
