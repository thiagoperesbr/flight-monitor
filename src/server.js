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

function formatDate(dateString) {
  const [year, month, day] = dateString.split("-");
  return `${day}/${month}/${year}`;
}

function formatTime(timeString) {
  const [date, time, ampm] = timeString.split(" ", 3);

  return `${time} ${ampm}`;
}

async function fetchCalendarPicker(departure_id, arrival_id) {
  try {
    const startDate = new Date("2025-05-01").toISOString().split("T")[0];
    const endDate = new Date("2025-05-31").toISOString().split("T")[0];

    const options = {
      method: "GET",
      url: "https://google-flights2.p.rapidapi.com/api/v1/getCalendarPicker",
      params: {
        departure_id,
        arrival_id,
        start_date: startDate,
        end_date: endDate,
        travel_class: "ECONOMY",
        trip_type: "ROUND",
        trip_days: "11",
        adults: "1",
        children: "0",
        infant_on_lap: "0",
        infant_in_seat: "0",
        currency: "BRL",
        country_code: "BR",
      },
      headers: {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "google-flights2.p.rapidapi.com",
      },
    };

    const response = await axios.request(options);

    return response.data.data;
  } catch (err) {
    console.error(
      `Erro ao buscar voos (${departure_id} - ${arrival_id}):`,
      err.message
    );
    return [];
  }
}

async function fetchSearchFlights(
  departure_id,
  arrival_id,
  outbound_date,
  return_date
) {
  try {
    const options = {
      method: "GET",
      url: "https://google-flights2.p.rapidapi.com/api/v1/searchFlights",
      params: {
        departure_id,
        arrival_id,
        outbound_date,
        return_date,
        travel_class: "ECONOMY",
        adults: "1",
        children: "0",
        infant_on_lap: "0",
        infant_in_seat: "0",
        show_hidden: "1",
        currency: "BRL",
        language_code: "pt-BR",
        country_code: "BR",
      },
      headers: {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "google-flights2.p.rapidapi.com",
      },
    };

    const response = await axios.request(options);

    return response.data.data;
  } catch (err) {
    console.error(
      `Erro ao buscar voos (${departure_id} - ${arrival_id}):`,
      err.message
    );
    return [];
  }
}

async function fetchNextFlights(next_token) {
  try {
    const options = {
      method: "GET",
      url: "https://google-flights2.p.rapidapi.com/api/v1/getNextFlights",
      params: {
        next_token,
        show_hidden: "1",
        currency: "BRL",
        language_code: "pt-BR",
        country_code: "BR",
      },
      headers: {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "google-flights2.p.rapidapi.com",
      },
    };

    const response = await axios.request(options);
    return response.data.data;
  } catch (err) {
    console.error("Erro ao buscar voos com next_token:", err.message);
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

const destinations = [
  { departure_id: "GIG", arrival_id: "SSA", destino: "Salvador" },
  { departure_id: "GIG", arrival_id: "REC", destino: "Recife" },
  { departure_id: "GIG", arrival_id: "MCZ", destino: "Maceió" },
];

cron.schedule("0 */4 * * *", async () => {
  console.log("Verificando passagens...");

  try {
    for (const { departure_id, arrival_id, destino } of destinations) {
      console.log(
        `Verificando voos de ida/volta do Rio de Janeiro (${departure_id}) para ${destino} (${arrival_id})`
      );

      const calendarPicker = await fetchCalendarPicker(
        departure_id,
        arrival_id
      );

      const filteredFlights = calendarPicker.filter(
        (picker) => picker.price < 700
      );

      if (filteredFlights.length === 0) {
        console.log(
          `Nenhum voo de ida/volta do Rio de Janeiro para ${destino} abaixo de R$ 700 reais encontrado.`
        );
        continue;
      }

      for (const filterflight of filteredFlights) {
        let consolidatedMessage =
          `✈️ *Oferta de Passagem Aérea Encontrada!*\n\n` +
          `- *Origem:* Rio de Janeiro (${departure_id})\n` +
          `- *Destino:* ${destino} (${arrival_id})\n` +
          `- *Data Ida:* ${formatDate(filterflight.departure)}\n` +
          `- *Data Volta:* ${formatDate(filterflight.return)}\n` +
          `- *Total (ida/volta):* R$ ${filterflight.price.toFixed(2)}\n\n`;

        const flightsIda = await fetchSearchFlights(
          departure_id,
          arrival_id,
          filterflight.departure,
          filterflight.return
        );

        const nextToken = flightsIda.itineraries?.topFlights[0].next_token;

        const allFlightsIda = [
          ...(flightsIda.itineraries?.topFlights || []),
          ...(flightsIda.itineraries?.otherFlights || []),
        ];

        const matchingFlightsIda = allFlightsIda.filter((flight) => {
          const isPriceMatch = flight.price === filterflight.price;
          const isDirect = !flight.layovers;

          return isPriceMatch && isDirect;
        });

        if (matchingFlightsIda.length > 0) {
          matchingFlightsIda.forEach((flight, index) => {
            consolidatedMessage +=
              `*Voo de IDA ${index + 1}:*\n` +
              `- *Companhia Aérea:* ${flight.flights[0].airline}\n` +
              `- *Horário de Partida:* ${formatTime(flight.departure_time)}\n` +
              `- *Horário de Chegada:* ${formatTime(flight.arrival_time)}\n` +
              `- *Duração:* ${flight.duration?.text || "Indisponível"}\n` +
              `- *Tipo:* Direto\n\n`;
          });
        } else {
          console.log("Nenhum voo de ida correspondente encontrado.");
        }

        const flightsVolta = await fetchNextFlights(nextToken);

        const allFlightsVolta = [
          ...(flightsVolta.itineraries?.topFlights || []),
          ...(flightsVolta.itineraries?.otherFlights || []),
        ];

        const matchingFlightsVolta = allFlightsVolta.filter((flight) => {
          const isPriceMatch = flight.price === filterflight.price;
          const isDirect = !flight.layovers;

          return isPriceMatch && isDirect;
        });

        if (matchingFlightsVolta.length > 0) {
          matchingFlightsVolta.forEach((flight, index) => {
            consolidatedMessage +=
              `*Voo de VOLTA ${index + 1}:*\n` +
              `- *Companhia Aérea:* ${flight.flights[0].airline}\n` +
              `- *Horário de Partida:* ${formatTime(flight.departure_time)}\n` +
              `- *Horário de Chegada:* ${formatTime(flight.arrival_time)}\n` +
              `- *Duração:* ${flight.duration?.text || "Indisponível"}\n` +
              `- *Tipo:* Direto\n\n`;
          });
        } else {
          console.log("Nenhum voo de volta correspondente encontrado.");
        }

        await sendTelegramMessage(consolidatedMessage);
      }
    }

    console.log("Concluída a verificação das passagens.");
  } catch (err) {
    console.error("Ocorreu um erro durante a verificação das passagens.");
  }
});

app.listen(8801, () => {
  console.log("Server running on port 8801.");
});
