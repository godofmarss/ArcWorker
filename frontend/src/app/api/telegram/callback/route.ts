typescriptimport { NextResponse } from 'next/server';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MINI_APP_URL = 'https://t.me/arcworkerbot/arcworker';

async function answerCallback(callbackQueryId: string) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
}

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

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const callbackQuery = body.callback_query;
        if (!callbackQuery) return NextResponse.json({ ok: true });

        const chatId = callbackQuery.message.chat.id;
        const data = callbackQuery.data;

        await answerCallback(callbackQuery.id);

        if (data === 'start_earning') {
            await sendMessage(chatId,
                `🚀 *Let's get you earning!*\n\nComplete simple AI tasks — surveys, labeling, reviews — and get paid instantly in *USDC* to your wallet.\n\n⚡ No KYC. No delays. Just work and earn.`,
                {
                    inline_keyboard: [[
                        { text: '🎯 Open ArcWorker', web_app: { url: 'https://arc-worker-neon.vercel.app' } }
                    ]]
                }
            );
        }

        if (data === 'learn_more') {
            await sendMessage(chatId,
                `📖 *How ArcWorker works:*\n\n1️⃣ Open the app\n2️⃣ Pick a task — surveys, AI labeling, reviews\n3️⃣ Submit your answer\n4️⃣ Get paid instantly in *USDC*\n\n💼 Your wallet is created automatically — no setup needed.\n🔒 Powered by Circle & blockchain escrow.`,
                {
                    inline_keyboard: [[
                        { text: '💰 Start Earning Now', web_app: { url: 'https://arc-worker-neon.vercel.app' } }
                    ]]
                }
            );
        }

        return NextResponse.json({ ok: true });
    } catch (e) {
        return NextResponse.json({ ok: true });
    }
}
