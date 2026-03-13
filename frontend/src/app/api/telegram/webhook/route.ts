import { NextResponse } from 'next/server';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MINI_APP_URL = 'https://t.me/arcworkerbot/arcworker';

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
    } catch (e) {
        return NextResponse.json({ ok: true });
    }
}

export async function GET() {
    return NextResponse.json({ ok: true, message: 'ArcWorker bot webhook active' });
}
