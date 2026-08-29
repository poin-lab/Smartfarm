const endpoint =
  process.env.IOT_API_URL || "http://localhost:4100/api/iot/ingest/sensors";
const apiKey = process.env.IOT_DEVICE_KEY;

if (!apiKey)
  throw new Error(
    "Set IOT_DEVICE_KEY to the one-time key returned when provisioning a sensor device.",
  );

const send = async () => {
  const temperature = Number(
    (24 + Math.sin(Date.now() / 60000) * 1.5).toFixed(1),
  );
  const payload = {
    temperature,
    humidity: 66,
    light: 12400,
    co2: 720,
    soilMoisture: 54,
    ph: 6.2,
    ec: 1.8,
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-Key": apiKey },
    body: JSON.stringify(payload),
  });
  if (!response.ok)
    throw new Error(`${response.status} ${await response.text()}`);
  console.log(`[${new Date().toISOString()}] sensor reading accepted`, payload);
};

await send();
setInterval(
  () =>
    send().catch((error) =>
      console.error("Sensor send failed:", error.message),
    ),
  5000,
);
