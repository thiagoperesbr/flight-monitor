import * as dotenv from "dotenv";
import express from "express";
import cron from "node-cron";
import axios from "axios";
import TelegramBot from "node-telegram-bot-api";

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

function isMayDate(date) {
  return date.startsWith("2025-05");
}

function addDaystoDate(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result.toISOString().split("T")[0];
}

function formatDate(dateString) {
  const [year, month, day] = dateString.split("-");
  return `${day}/${month}/${year}`;
}

async function fetchFlights(fromEntityId, toEntityId) {
  try {
    const departDate = new Date("2025-05-01").toISOString().split("T")[0];

    const options = {
      method: "GET",
      url: "https://sky-scanner3.p.rapidapi.com/flights/price-calendar",
      params: {
        fromEntityId,
        toEntityId,
        departDate,
        market: "BR",
        locale: "pt-BR",
        currency: "BRL",
      },
      headers: {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "sky-scanner3.p.rapidapi.com",
      },
    };

    const response = await axios.request(options);

    return response.data.data.flights.days;
  } catch (err) {
    console.error(
      `Erro ao buscar voos (${fromEntityId} - ${toEntityId}):`,
      err.message
    );
    return [];
  }
}

async function sendTelegramMessage(message) {
  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Erro ao enviar mensagem no Telegram:", err.message);
  }
}

cron.schedule("0 8,12,16,20 * * *", async () => {
  console.log("Verificando passagens...");

  const outboundFlights = await fetchFlights("GIG", "SSA");

  const mayOutboundFlights = outboundFlights.filter(
    (flight) => isMayDate(flight.day) && flight.price < 360.0
  );

  if (mayOutboundFlights.length === 0) {
    console.log("Nenhum voo de ida abaixo de R$350 encontrado.");
    return;
  }

  const returnDates = mayOutboundFlights.map((flight) => ({
    outbound: flight,
    returnDate: addDaystoDate(flight.day, 12),
  }));

  const inboundFlights = await fetchFlights("SSA", "GIG");

  const matchedFlights = [];

  for (const { outbound, returnDate } of returnDates) {
    const matchingReturnFlight = inboundFlights.find(
      (flight) => flight.day === returnDate && flight.price < 360.0
    );

    if (matchingReturnFlight) {
      matchedFlights.push({
        outbound,
        inbound: matchingReturnFlight,
      });
    }
  }

  if (matchedFlights.length > 0) {
    const messages = matchedFlights.map(({ outbound, inbound }) => {
      const totalPrice = (outbound.price + inbound.price).toFixed(2);
      return (
        `✈️ *Oferta de Passagem Aérea Encontrada!*\n\n` +
        `- *Origem:* Rio de Janeiro (GIG)\n` +
        `- *Destino:* Salvador (SSA)\n` +
        `- *Data Ida:* ${formatDate(outbound.day)}\n` +
        `- *Preço Ida:* R$ ${outbound.price.toFixed(2)}\n\n` +
        `- *Origem:* Salvador (SSA)\n` +
        `- *Destino:* Rio de Janeiro (SDU)\n` +
        `- *Data Volta:* ${formatDate(inbound.day)}\n` +
        `- *Preço Volta:* R$ ${inbound.price.toFixed(2)}\n\n` +
        `- *Total (ida/volta):* R$ ${totalPrice}\n`
      );
    });

    await sendTelegramMessage(messages.join("\n\n"));
  } else {
    console.log("Nenhuma combinação de ida e volta encontrada.");
  }
});

app.listen(8800, () => {
  console.log("Server running on port 8800.");
});
