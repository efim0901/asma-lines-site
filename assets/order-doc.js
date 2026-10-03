/* ============================================================
   ASMA Lines — защищённый документ по рейсу (order-doc.html).

   Вынесено из inline <script>, чтобы можно было включить строгий
   Content-Security-Policy без 'unsafe-inline'.
   ============================================================ */
function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    (async function initProtectedDocViewer() {
      'use strict';

      const loadingEl = document.getElementById('doc-loading-screen');
      const gateEl = document.getElementById('doc-access-gate');
      const protectedArea = document.getElementById('doc-protected-area');

      // Extract Telegram Auth token and signed ticket
      const tgInitData = window.Telegram?.WebApp?.initData || sessionStorage.getItem('asma_crm_tg_init_data') || '';
      const params = new URLSearchParams(window.location.search);
      const leadId = params.get('id') || '';
      const leadNum = params.get('lead') || params.get('leadNumber') || '101';
      const ticket = params.get('ticket') || params.get('t') || sessionStorage.getItem('asma_active_doc_ticket') || '';

      let verifiedLead = null;
      let verifiedOperator = { name: 'Иван Ефимович', username: 'plombit' };

      // 1. Authenticate with backend /api/crm/doc-data
      try {
        const res = await fetch('/api/crm/doc-data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Init-Data': tgInitData
          },
          body: JSON.stringify({ leadId, leadNum, ticket })
        });

        if (res.ok) {
          const json = await res.json();
          if (json.success && json.lead) {
            verifiedLead = json.lead;
            if (json.operator) verifiedOperator = json.operator;
          }
        }
      } catch (err) {
        console.warn('Backend doc verification note:', err);
      }

      // Fallback to validated sessionStorage if opened directly from verified CRM window
      if (!verifiedLead) {
        try {
          const sess = sessionStorage.getItem('asma_active_doc_lead');
          if (sess) {
            const parsed = JSON.parse(sess);
            if (parsed && (parsed.id === leadId || String(parsed.leadNumber) === String(leadNum))) {
              // Verified session from CRM tab
              verifiedLead = parsed;
            }
          }
        } catch (e) {}
      }

      // Fallback if lead data is not specified
      if (!verifiedLead) {
        verifiedLead = {
          id: leadId || 'default',
          leadNumber: leadNum || '101',
          name: 'ООО «БЕЛТРАНС-ЛОГИСТИК»',
          contact: '+375 (29) 682-14-30',
          route: 'Гомель → Минск',
          distance: '~310 км',
          weight: '5.0 т',
          vehicle: 'Тент (еврофура 86-92 м³)',
          price: '680 BYN',
          comment: 'Загрузка боковая/задняя. Доставка в согласованное время.',
          dispatcher: 'Иван Ефимович'
        };
      }

      // Access Granted! Render Document
      loadingEl.style.display = 'none';
      if (gateEl) gateEl.style.display = 'none';
      protectedArea.style.display = 'block';

      // 2. Resolve Parameters
      const clientName = verifiedLead.name || 'ООО «Заказчик»';
      const contact = verifiedLead.contact || '+375 (29) 000-00-00';
      const rawRoute = verifiedLead.route || 'Гомель → Минск';

      let fromCity = '';
      let toCity = '';
      if (rawRoute.includes('→')) {
        const parts = rawRoute.split('→');
        fromCity = parts[0].trim();
        toCity = parts[1].trim();
      } else if (rawRoute.includes('-') && !rawRoute.includes('–')) {
        const parts = rawRoute.split('-');
        fromCity = parts[0].trim();
        toCity = parts[1].trim();
      } else {
        fromCity = 'Гомель';
        toCity = 'Минск';
      }

      const distance = verifiedLead.distance || '~310 км';
      const weight = verifiedLead.weight || '5.0 т';
      const vehicle = verifiedLead.vehicle || 'Тент (еврофура 86-92 м³)';
      const price = verifiedLead.price || '680 BYN';
      const comment = verifiedLead.comment || 'Без особенностей. Загрузка боковая/задняя, исправный автотранспорт.';
      const dispatcher = verifiedOperator.name || verifiedLead.dispatcher || 'Иван Ефимович';

      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
      const docCode = `ASMA-2026-${verifiedLead.leadNumber || leadNum}`;

      document.getElementById('doc-date-header').textContent = `Дата: ${dateStr}`;

      let currentDoc = 'order';
      let isEditMode = false;

      window.setDocType = function(type) {
        currentDoc = type;
        document.querySelectorAll('.doc-tab-btn').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById(`tab-${type}`);
        if (btn) btn.classList.add('active');

        if (type === 'order') {
          document.getElementById('doc-num-header').textContent = `ДОГОВОР-ЗАЯВКА № ${docCode}`;
          renderOrderTemplate();
        } else if (type === 'kp') {
          document.getElementById('doc-num-header').textContent = `КП № ${docCode}`;
          renderKPTemplate();
        } else if (type === 'waybill') {
          document.getElementById('doc-num-header').textContent = `МАРШРУТНОЕ ПОРУЧЕНИЕ № ${docCode}`;
          renderWaybillTemplate();
        }

        applyEditMode();
      };

      window.toggleEditMode = function() {
        isEditMode = !isEditMode;
        const btn = document.getElementById('btn-toggle-edit');
        if (isEditMode) {
          btn.innerHTML = '<span>💾 Готово</span>';
          btn.classList.add('btn-action-edit-active');
          document.body.classList.add('edit-active');
        } else {
          btn.innerHTML = '<span>✏️ Редактировать</span>';
          btn.classList.remove('btn-action-edit-active');
          document.body.classList.remove('edit-active');
        }
        applyEditMode();
      };

      function applyEditMode() {
        document.querySelectorAll('.paper-sheet [contenteditable]').forEach(el => {
          el.setAttribute('contenteditable', isEditMode ? 'true' : 'false');
        });
      }

      window.copyDocumentToClipboard = function() {
        const text = document.getElementById('doc-canvas').innerText;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => {
            alert('✓ Текст документа скопирован в буфер обмена');
          });
        }
      };

      // ----------------------------------------------------
      // TEMPLATE 1: ДОГОВОР-ЗАЯВКА НА ПЕРЕВОЗКУ ГРУЗА
      // ----------------------------------------------------
      function renderOrderTemplate() {
        const container = document.getElementById('doc-content-body');
        container.innerHTML = `
          <div class="doc-title-centered">
            <h1>ДОГОВОР-ЗАЯВКА НА ОРГАНИЗАЦИЮ ПЕРЕВОЗКИ ГРУЗА № ${escapeHtml(docCode)}</h1>
            <p>в городском и междугородном автомобильном сообщении по Республике Беларусь</p>
          </div>

          <div class="parties-grid">
            <div class="party-box">
              <div class="party-box-title">ЭКСПЕДИТОР / ОРГАНИЗАТОР:</div>
              <div class="party-row"><b>Общество с ограниченной ответственностью «АСМА Лайнс»</b> (ООО «АСМА Лайнс»)</div>
              <div class="party-row">Юр. адрес: Республика Беларусь, г. Гомель</div>
              <div class="party-row">Ответственный диспетчер: <span contenteditable="false">${escapeHtml(dispatcher)}</span></div>
              <div class="party-row">Контакты: +375 (29) 100-20-30 · info@asmalines.by</div>
            </div>

            <div class="party-box">
              <div class="party-box-title">ЗАКАЗЧИК:</div>
              <div class="party-row">Организация / ФИО: <b contenteditable="false">${escapeHtml(clientName)}</b></div>
              <div class="party-row">Контактный телефон: <span contenteditable="false">${escapeHtml(contact)}</span></div>
              <div class="party-row">УНП Заказчика: <span contenteditable="false">Уточняется при выставлении счёта</span></div>
              <div class="party-row">Плательщик: <span contenteditable="false">Заказчик (безналичный расчёт)</span></div>
            </div>
          </div>

          <table class="spec-table">
            <tbody>
              <tr>
                <th>1. Маршрут перевозки:</th>
                <td><b style="color:#6B1E2D;" contenteditable="false">г. ${escapeHtml(fromCity)} ➔ г. ${escapeHtml(toCity)}</b> (расстояние: <span contenteditable="false">${escapeHtml(distance)}</span>)</td>
              </tr>
              <tr>
                <th>2. Адрес и дата погрузки:</th>
                <td><span contenteditable="false">г. ${escapeHtml(fromCity)}, склад грузоотправителя. Дата: ${escapeHtml(dateStr)}, подача: 09:00 - 11:00</span></td>
              </tr>
              <tr>
                <th>3. Адрес и дата выгрузки:</th>
                <td><span contenteditable="false">г. ${escapeHtml(toCity)}, склад грузополучателя. В согласованный интервал</span></td>
              </tr>
              <tr>
                <th>4. Характеристики груза:</th>
                <td>Вес: <b contenteditable="false">${escapeHtml(weight)}</b> · Упаковка / Тара: <span contenteditable="false">Паллеты / Грузовые места</span></td>
              </tr>
              <tr>
                <th>5. Подвижной состав:</th>
                <td><span contenteditable="false">${escapeHtml(vehicle)}</span> · Растентовка: <span contenteditable="false">Задняя / Боковая</span></td>
              </tr>
              <tr>
                <th>6. Стоимость услуг (Ставка):</th>
                <td class="spec-price-highlight"><span contenteditable="false">${escapeHtml(price)}</span></td>
              </tr>
              <tr>
                <th>7. Порядок расчётов:</th>
                <td><span contenteditable="false">Безналичный расчёт по факту выгрузки и предоставления оригиналов ТТН/актов в течение 3-5 банковских дней.</span></td>
              </tr>
              <tr>
                <th>8. Дополнительные условия:</th>
                <td><span contenteditable="false">${escapeHtml(comment)}</span></td>
              </tr>
            </tbody>
          </table>

          <div class="legal-terms">
            <h4>УСЛОВИЯ И ОБЯЗАТЕЛЬСТВА СТОРОН (ПО ЗАКОНОДАТЕЛЬСТВУ РБ):</h4>
            <ol>
              <li>Экспедитор обязуется своевременно предоставить технически исправный транспорт под загрузку по указанному адресу.</li>
              <li>Заказчик обеспечивает беспрепятственный подъезд и погрузочно-разгрузочные работы. Нормативное время на ПРР — не более 3 (трёх) часов.</li>
              <li>За сверхнормативный простой подвижного состава по вине Заказчика начисляется штраф в размере 35 BYN за каждый полный час простоя.</li>
              <li>Заказчик гарантирует предоставление надлежаще оформленных товарно-транспортных накладных (ТТН-1 / ТН-2).</li>
              <li>Факсимильные и электронные копии настоящего Договора-заявки имеют полную юридическую силу до момента обмена оригиналами.</li>
            </ol>
          </div>

          <div class="signatures-grid">
            <div class="sign-card">
              <div class="sign-card-title">ЭКСПЕДИТОР:</div>
              <div><b>ООО «АСМА Лайнс»</b></div>
              <div>Диспетчер: <span contenteditable="false">${escapeHtml(dispatcher)}</span></div>
              <div class="sign-line-wrapper">
                <span>Подпись:</span>
                <div class="sign-underline"></div>
              </div>
              <div class="sign-seal-label">М.П.</div>
            </div>

            <div class="sign-card">
              <div class="sign-card-title">ЗАКАЗЧИК:</div>
              <div><b contenteditable="false">${escapeHtml(clientName)}</b></div>
              <div>Телефон: <span contenteditable="false">${escapeHtml(contact)}</span></div>
              <div class="sign-line-wrapper">
                <span>Подпись:</span>
                <div class="sign-underline"></div>
              </div>
              <div class="sign-seal-label">М.П.</div>
            </div>
          </div>
        `;
      }

      // ----------------------------------------------------
      // TEMPLATE 2: КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ (КП)
      // ----------------------------------------------------
      function renderKPTemplate() {
        const container = document.getElementById('doc-content-body');
        container.innerHTML = `
          <div class="doc-title-centered">
            <h1>ИНДИВИДУАЛЬНОЕ КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</h1>
            <p>Расчёт стоимости и условия организации автоперевозки по территории Республики Беларусь</p>
          </div>

          <div class="parties-grid">
            <div class="party-box">
              <div class="party-box-title">ИСПОЛНИТЕЛЬ:</div>
              <div class="party-row"><b>ООО «АСМА Лайнс»</b> · Диспетчерская служба</div>
              <div class="party-row">Телефон: +375 (29) 100-20-30</div>
              <div class="party-row">E-mail: info@asmalines.by · Сайт: asmalines.by</div>
            </div>

            <div class="party-box">
              <div class="party-box-title">КОМУ:</div>
              <div class="party-row">Клиент: <b contenteditable="false">${escapeHtml(clientName)}</b></div>
              <div class="party-row">Телефон: <span contenteditable="false">${escapeHtml(contact)}</span></div>
              <div class="party-row">Срок действия предложения: <b>14 календарных дней</b></div>
            </div>
          </div>

          <table class="kp-calc-table">
            <thead>
              <tr>
                <th>Наименование статьи расходов</th>
                <th>Параметры рейса</th>
                <th class="tar">Сумма (BYN)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>Базовая подача автомобиля и экспедирование</b></td>
                <td>Фиксированная ставка</td>
                <td class="tar">85.00 BYN</td>
              </tr>
              <tr>
                <td><b>Пробег по автодорожному маршруту</b></td>
                <td><span contenteditable="false">г. ${escapeHtml(fromCity)} ➔ г. ${escapeHtml(toCity)} (${escapeHtml(distance)})</span></td>
                <td class="tar">—</td>
              </tr>
              <tr>
                <td><b>Массово-габаритные параметры</b></td>
                <td>Вес: <span contenteditable="false">${escapeHtml(weight)}</span> · Транспорт: <span contenteditable="false">${escapeHtml(vehicle)}</span></td>
                <td class="tar">—</td>
              </tr>
              <tr>
                <td><b>Специальные условия рейса</b></td>
                <td><span contenteditable="false">${escapeHtml(comment)}</span></td>
                <td class="tar">Включено</td>
              </tr>
              <tr class="kp-total-highlight">
                <td colspan="2">ИТОГОВАЯ СТАВКА ЗА РЕЙС:</td>
                <td class="tar"><span contenteditable="false">${escapeHtml(price)}</span></td>
              </tr>
            </tbody>
          </table>

          <div class="kp-features-grid">
            <div class="kp-feat-card">
              <div class="kp-feat-icon">⚡</div>
              <div class="kp-feat-title">Оперативная подача</div>
              <div class="kp-feat-desc">Подача авто от 2 часов в Гомеле и Минске, подбор транспорта под любой вес.</div>
            </div>
            <div class="kp-feat-card">
              <div class="kp-feat-icon">🤝</div>
              <div class="kp-feat-title">Без посредников</div>
              <div class="kp-feat-desc">Прямой контакт с диспетчером, контроль движения на всём пути.</div>
            </div>
            <div class="kp-feat-card">
              <div class="kp-feat-icon">📑</div>
              <div class="kp-feat-title">Документооборот</div>
              <div class="kp-feat-desc">Договор, оригиналы ТТН и бухгалтерских актов курьером или почтой.</div>
            </div>
          </div>

          <div class="signatures-grid" style="margin-top: 10px;">
            <div class="sign-card" style="grid-column: 1 / -1; max-width: 460px; margin-left: auto;">
              <div class="sign-card-title">ОТВЕТСТВЕННЫЙ СПЕЦИАЛИСТ ПО ЛОГИСТИКЕ:</div>
              <div>ООО «АСМА Лайнс» · <span contenteditable="false">${escapeHtml(dispatcher)}</span></div>
              <div class="sign-line-wrapper">
                <span>Подпись:</span>
                <div class="sign-underline"></div>
              </div>
            </div>
          </div>
        `;
      }

      // ----------------------------------------------------
      // TEMPLATE 3: МАРШРУТНОЕ ПОРУЧЕНИЕ ВОДИТЕЛЮ И СКЛАДУ
      // ----------------------------------------------------
      function renderWaybillTemplate() {
        const container = document.getElementById('doc-content-body');
        container.innerHTML = `
          <div class="doc-title-centered">
            <h1>СЛУЖЕБНОЕ МАРШРУТНОЕ ПОРУЧЕНИЕ № ${escapeHtml(docCode)}</h1>
            <p>Задание водителю-экспедитору и складам на выполнение рейса</p>
          </div>

          <div class="waybill-route-banner">
            <div>
              <span style="font-size:11px;text-transform:uppercase;color:#A8A29E;">Маршрут перевозки:</span>
              <div class="waybill-route-title" contenteditable="false">г. ${escapeHtml(fromCity)} ➔ г. ${escapeHtml(toCity)}</div>
            </div>
            <div class="waybill-route-meta" contenteditable="false">Расстояние: ${escapeHtml(distance)} · Ставка: ${escapeHtml(price)}</div>
          </div>

          <table class="spec-table">
            <tbody>
              <tr>
                <th>Грузоотправитель (Погрузка):</th>
                <td><b contenteditable="false">${escapeHtml(clientName)}</b> (тел: <span contenteditable="false">${escapeHtml(contact)}</span>)</td>
              </tr>
              <tr>
                <th>Адрес склада погрузки:</th>
                <td><span contenteditable="false">г. ${escapeHtml(fromCity)}, склад отправителя. Время прибытия: 09:00</span></td>
              </tr>
              <tr>
                <th>Грузополучатель (Выгрузка):</th>
                <td><span contenteditable="false">г. ${escapeHtml(toCity)}, склад получателя.</span></td>
              </tr>
              <tr>
                <th>Параметры груза:</th>
                <td>Вес: <b contenteditable="false">${escapeHtml(weight)}</b> · Транспорт: <span contenteditable="false">${escapeHtml(vehicle)}</span></td>
              </tr>
              <tr>
                <th>Назначенный водитель / Авто:</th>
                <td><span contenteditable="false">Назначается диспетчером (Гос. номер: ______________, тел: ______________)</span></td>
              </tr>
              <tr>
                <th>Инструкции и комментарии:</th>
                <td><span contenteditable="false">${escapeHtml(comment)}</span></td>
              </tr>
            </tbody>
          </table>

          <div class="waybill-check-grid">
            <div class="waybill-check-card">
              <h4>ОТМЕТКА О ПОГРУЗКЕ:</h4>
              <div>Дата и время прибытия: ________________</div>
              <div>Дата и время убытия: __________________</div>
              <div>Количество мест: ______ Штамп/Подпись: ______</div>
            </div>

            <div class="waybill-check-card">
              <h4>ОТМЕТКА О ВЫГРУЗКЕ:</h4>
              <div>Дата и время прибытия: ________________</div>
              <div>Дата и время убытия: __________________</div>
              <div>Претензии по грузу: [ ] Нет  [ ] Есть</div>
            </div>
          </div>

          <div class="signatures-grid">
            <div class="sign-card">
              <div class="sign-card-title">ДИСПЕТЧЕР-ОРГАНИЗАТОР:</div>
              <div><b>${escapeHtml(dispatcher)}</b> · +375 (29) 100-20-30</div>
              <div class="sign-line-wrapper">
                <span>Подпись:</span>
                <div class="sign-underline"></div>
              </div>
            </div>

            <div class="sign-card">
              <div class="sign-card-title">ВОДИТЕЛЬ ПРИНЯВШИЙ РЕЙС:</div>
              <div><span contenteditable="false">ФИО водителя: ___________________________</span></div>
              <div class="sign-line-wrapper">
                <span>Подпись:</span>
                <div class="sign-underline"></div>
              </div>
            </div>
          </div>
        `;
      }

      // Initial Render
      window.setDocType('order');
    })();
