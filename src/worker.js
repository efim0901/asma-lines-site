export default {
  async fetch(request, env, ctx) {
    // Поддержка CORS (для локальной отладки и cross-origin запросов)
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Принимаем только POST запросы на маршрут /api/lead
    if (url.pathname !== "/api/lead" || request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Endpoint or method not supported" }),
        { status: 405, headers: corsHeaders }
      );
    }

    try {
      const body = await request.json();
      const { 
        name, 
        contact, 
        message, 
        source, 
        from, 
        to, 
        distance, 
        weight, 
        cargo, 
        loading, 
        calculatedEstimate 
      } = body;

      if (!contact && !name) {
        return new Response(
          JSON.stringify({ success: false, error: "Name or contact required" }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Формирование текста комментария к Лиду
      const commentLines = [];
      if (message) commentLines.push(`💬 Сообщение: ${message}`);
      if (from || to) commentLines.push(`📍 Маршрут: \({from || '?'} →\){to || '?'}`);
      if (distance) commentLines.push(`📏 Расстояние: ${distance} км`);
      if (weight) commentLines.push(`⚖️ Вес груза: ${weight} т`);
      if (cargo) commentLines.push(`📦 Тип груза: ${cargo}`);
      if (loading) commentLines.push(`🏗 Нужна погрузка/разгрузка: Да`);
      if (calculatedEstimate) commentLines.push(`💰 Предварительная оценка: ${calculatedEstimate} BYN`);

      const comments = commentLines.join("\n");

      // Автоматическое определение Email или Телефон
      const isEmail = contact && contact.includes("@");
      const phoneArray = !isEmail && contact ? [{ VALUE: contact, VALUE_TYPE: "WORK" }] : [];
      const emailArray = isEmail && contact ? [{ VALUE: contact, VALUE_TYPE: "WORK" }] : [];

      // Тело запроса к REST API Битрикс24 (crm.lead.add)
      const b24Payload = {
        fields: {
          TITLE: `Заявка с сайта (${source || "Контакты"})`,
          NAME: name || "Заявка с сайта",
          PHONE: phoneArray,
          EMAIL: emailArray,
          COMMENTS: comments,
          SOURCE_ID: "WEB", // Источник в CRM
        },
        params: { REGISTER_SONET_EVENT: "Y" } // Создать уведомление сотрудникам в CRM
      };

      // Получаем URL вебхука из переменных окружения Cloudflare
      const webhookBaseUrl = env.BITRIX24_WEBHOOK_URL;
      if (!webhookBaseUrl) {
        throw new Error("Переменная окружения BITRIX24_WEBHOOK_URL не настроена.");
      }

      // Формируем итоговый URL метода crm.lead.add.json
      const endpoint = webhookBaseUrl.endsWith("/")
        ? `${webhookBaseUrl}crm.lead.add.json`
        : `${webhookBaseUrl}/crm.lead.add.json`;

      // Отправляем запрос в Битрикс24
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b24Payload),
      });

      const b24Result = await response.json();

      if (b24Result.error) {
        return new Response(
          JSON.stringify({ success: false, error: b24Result.error_description }),
          { status: 500, headers: corsHeaders }
        );
      }

      return new Response(
        JSON.stringify({ success: true, lead_id: b24Result.result }),
        { status: 200, headers: corsHeaders }
      );

    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: err.message }),
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
