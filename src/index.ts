import { ChatCompletionMessageParam } from 'openai/resources/chat';
import { Message, Whatsapp, create } from 'venom-bot';
import { openai } from './lib/openai';
import { redis } from './lib/redis';
import { initPrompt } from './utils/initPrompt';

interface CustomerChat {
	status?: 'open' | 'closed'
	orderCode: string
	chatAt: string
	customer: {
		name: string
		phone: string
	}
	messages: ChatCompletionMessageParam[]
	orderSummary?: string
}

async function completion(messages: Array<ChatCompletionMessageParam>): Promise<string | null> {
	const completion = await openai.chat.completions.create({
		model: 'gpt-3.5-turbo',
		temperature: 0.3,
		max_tokens: 256,
		messages,
	});

	return completion.choices[0].message.content;
}

create({
	session: 'food-gpt',
	disableWelcome: true,
})
	.then(async (client: Whatsapp) => await start(client))
	.catch((err) => {
		console.log(err);
	});

async function start(client: Whatsapp) {
	client.onMessage(async (message: Message) => {
		if (!message.body || message.isGroupMsg) return;

		const storeName = 'Lucas';
		const customerPhone = `+${message.from.replace('@c.us', '')}`;
		const customerName = message.author;
		const customerKey = `customer:${customerPhone}:chat`;
		const orderCode = `#sk-${('00000' + Math.random()).slice(-5)}`;

		const lastChat = JSON.parse((await redis.get(customerKey)) || '{}');

		const customerChat: CustomerChat =
			lastChat?.status === 'open'
				? (lastChat as CustomerChat)
				: {
					status: 'open',
					orderCode,
					chatAt: new Date().toISOString(),
					customer: {
						name: customerName,
						phone: customerPhone,
					},
					messages: [
						{
							role: 'system',
							content: initPrompt(storeName, orderCode),
						},
					],
					orderSummary: '',
				};

		console.debug(customerPhone, '👤', message.body);

		customerChat.messages.push({
			role: 'user',
			content: message.body
		});

		const response = (await completion(customerChat.messages)) || 'Não entendi...';

		customerChat.messages.push({
			role: 'assistant',
			content: response
		});

		console.debug(customerPhone, '🤖', response);

		await client.sendText(message.from, response);

		if (
			customerChat.status === 'open' &&
			response.match(customerChat.orderCode)
		) {
			customerChat.status = 'closed';

			customerChat.messages.push({
				role: 'user',
				content:
					'Gere um resumo de pedido para registro no sistema da pizzaria, quem está solicitando é um robô.',
			});

			const response =
				(await completion(customerChat.messages)) || 'Não entendi...';

			console.debug(customerPhone, '📦', response);

			customerChat.orderSummary = response;
		}

		redis.set(customerKey, JSON.stringify(customerChat));

	});
}