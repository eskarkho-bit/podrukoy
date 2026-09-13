# Витрина и публикация: App Store, Google Play, RuStore

Собрано 13.09.2026 по состоянию ветки `feature/marketplace-and-verification`.
Здесь всё, что вводится руками в кабинетах магазинов: тексты, ответы на
анкеты, записка ревьюеру, порядок шагов. Что сделано в репозитории, отмечено
галочками; что делает только владелец — помечено **[владелец]**.

Скриншоты лежат в `design/store/6.9/` (1320×2868) и `design/store/6.7/`
(1290×2796): снимаются скриптом с демо-маршрутов `/demo` и `/demo-master`
на dev-сервере, данные на них вымышленные. Для App Store Connect хватает
набора 6.9", остальные размеры он масштабирует сам.

---

## 1. Apple Developer Program [владелец]

1. Apple ID с двухфакторной аутентификацией — на него будет заведён аккаунт
   разработчика. Лучше отдельный, не личный.
2. Регистрация на developer.apple.com/programs как **Individual** (ИП по
   российскому праву для Apple — физлицо; Organization требует D-U-N-S и
   юрлицо). Имя разработчика в магазине будет вашим ФИО, сменить на бренд
   можно только с Organization.
3. Оплата 99 $ в год. Российские карты Apple не принимает: нужна карта
   иностранного банка либо оплата через приложение Apple Developer на
   iPhone со счётом App Store другого региона. Это самый частый стопор —
   решать первым.
4. Подтверждение личности идёт через приложение Apple Developer (iPhone):
   документ и селфи. Обычно от нескольких часов до двух суток.

Пока аккаунта нет, ни APNs-ключ, ни iOS-сборка, ни TestFlight невозможны:
EAS подписывает сборку сертификатом из этого аккаунта.

## 2. Приложение в App Store Connect [владелец]

App Store Connect → My Apps → «+» → New App:

| Поле             | Значение                                                   |
| ---------------- | ---------------------------------------------------------- |
| Platforms        | iOS                                                        |
| Name             | `domio` (если занято — `domio: мастер на дом`)             |
| Primary Language | Russian                                                    |
| Bundle ID        | `com.domio.app` (регистрируется в Identifiers; EAS сделает |
|                  | это сам при первом `eas credentials`)                      |
| SKU              | `domio-ios`                                                |
| User Access      | Full Access                                                |

После создания выпишите **Apple ID приложения** (число в App Information,
«Apple ID») и **Team ID** (developer.apple.com → Membership). Они идут в
`eas.json`:

```json
"submit": {
  "production": {
    "ios": {
      "appleId": "почта Apple ID",
      "ascAppId": "число из App Information",
      "appleTeamId": "Team ID"
    }
  }
}
```

## 3. APNs и сборка

Сертификаты и APNs-ключ EAS заводит сам, спрашивая логин Apple ID
(нужен интерактивный терминал, это делает владелец):

```bash
eas credentials --platform ios
```

В диалоге: production → «Set up your project to use Push Notifications»
→ разрешить EAS создать APNs Key. Без ключа пуши на iOS не придут даже с
рабочими функциями. Затем сборка и отправка:

```bash
eas build --profile production --platform ios
```

```bash
eas submit --platform ios --latest
```

Сборка подписывается production-сертификатом и попадает в TestFlight
автоматически после `submit`. Первая загрузка на TestFlight ждёт проверку
экспортных ограничений: в `app.json` уже стоит
`ITSAppUsesNonExemptEncryption: false`, вопросов не будет.

- [x] `supportsTablet: false` — только iPhone: интерфейс телефонный, а с
      планшетом Apple потребовал бы скриншоты iPad и проверял бы вёрстку.
- [x] `microphonePermission: false` — видео не снимаем, лишнего разрешения
      в списке нет.

## 4. TestFlight [владелец]

Internal Testing: добавить себя и двух-трёх знакомых по Apple ID, сборка
доступна сразу без ревью. Прогон на живом iPhone — первый момент, когда вся
цепочка собирается вместе:

- вход по телефону: код приходит звонком, последние четыре цифры номера;
- камера: фото поломки в заявке и селфи в анкете мастера;
- пуши: новая заявка мастеру, предложение клиенту, сообщения чата;
- отметки оплаты «оплатил» / «получил», возврат работы, отказ мастера;
- удаление аккаунта из профиля.

External Testing (ссылка для посторонних) уже проходит ревью Apple, почти
такое же, как релизное, — им можно проверить записку ревьюеру заранее.

## 5. Витрина (App Information, Version Information)

**Name** (30 символов): `domio: мастер на дом`

**Subtitle** (30): `Сантехник, электрик, ремонт`

**Category:** Lifestyle; secondary — Utilities.

**Promotional Text** (170):

> Ткните в розетку на плане дома — и мастера рядом сами пришлют цену.
> Выбирайте по отзывам, договаривайтесь в чате, платите напрямую.

**Description** (до 4000):

> domio — вызов мастера на дом без обзвона и объявлений.
>
> Ваш дом нарисован на экране. Нажмите на то, что сломалось: розетку,
> смеситель, окно, люстру, ворота. Опишите проблему в пару касаний,
> приложите фото — заявка ушла проверенным мастерам вашего города.
>
> Мастера присылают цену и срок. Вы видите рейтинг, отзывы, стаж и число
> выполненных заказов — и выбираете сами. Никто не «берёт» вашу заявку без
> вашего согласия.
>
> После выбора открывается чат и кнопка «Позвонить». Оплата — напрямую
> мастеру: наличными или переводом по номеру телефона. Сервис не берёт
> комиссию с расчётов и не удерживает деньги.
>
> Каждый мастер проверен вручную: фотография лица и телефон, которые
> смотрит модератор. Если что-то пошло не так — жалоба уходит модерации,
> мастера можно заблокировать.
>
> Для мастеров: раздел «Я мастер» — лента заявок по вашим специальностям и
> городу, предложения цены, доходы по месяцам, отзывы.
>
> Сейчас сервис работает в Грозном.

**Keywords** (100 символов, через запятую, без пробелов):

`мастер,сантехник,электрик,ремонт,вызов,на дом,услуги,розетка,смеситель,люстра,грозный,бытовой`

**Support URL:** страница поддержки на хостинге документов (сейчас
`https://domio-7ad1c.web.app`; появится после `firebase deploy --only
hosting`, см. OPERATOR-SETUP).
**Marketing URL:** можно не указывать.
**Privacy Policy URL:** `https://domio-7ad1c.web.app/privacy.html` —
обязателен при создании версии, страница должна открываться.
**Copyright:** `2026 [ФИО ИП]` — после регистрации ИП.

**Age Rating.** Отвечать по анкете честно: насилия, азартных игр, медицины,
алкоголя нет; неограниченного доступа в интернет нет. Есть переписка между
пользователями и пользовательский контент (отзывы, фото) — в анкете 2025
года это отдельные вопросы, и по ним ожидаемая оценка **13+**. Спорить с
результатом не надо: 4+ для сервиса с чатом не пройдёт.

## 6. App Privacy («nutrition labels»)

Apple сверяет ответы с тем, что делает приложение. Что собираем и зачем:

| Тип данных (Apple)                | Что это у нас                           | Linked to user | Tracking | Purpose           |
| --------------------------------- | --------------------------------------- | -------------- | -------- | ----------------- |
| Contact Info → Name               | имя в профиле, имя и фамилия мастера    | да             | нет      | App Functionality |
| Contact Info → Email Address      | почта аккаунта                          | да             | нет      | App Functionality |
| Contact Info → Phone Number       | телефон входа; телефон мастера в анкете | да             | нет      | App Functionality |
| Contact Info → Physical Address   | адрес выполнения работ                  | да             | нет      | App Functionality |
| User Content → Photos or Videos   | фото поломки, фото в чате, фото лица    | да             | нет      | App Functionality |
| User Content → Other User Content | переписка, отзывы, описания заявок      | да             | нет      | App Functionality |
| Identifiers → User ID             | uid Firebase                            | да             | нет      | App Functionality |
| Diagnostics → Crash Data          | Sentry (после подключения DSN)          | нет            | нет      | App Functionality |

Чего **не** собираем и на что отвечать «нет»: Location (город выбирается из
списка, геолокации нет), Financial Info (номеров карт и счетов нет, платежи
идут мимо сервиса), Health, Browsing/Search History, Purchases, Usage Data,
Advertising Data. Tracking — нет: данные не передаются рекламным сетям и
не объединяются с чужими.

Фотография лица мастера — по сути биометрические данные по 152-ФЗ; в
анкете Apple нет отдельного пункта «селфи для проверки», и честнее всего
указать её как Photos с целью App Functionality, а в описании версии
(«What's New» не подходит, лучше в записке ревьюеру) сказать, что снимок
смотрит только модератор.

## 7. Записка ревьюеру и демо-доступ

Ревьюеры Apple отклоняют приложения, в которых не смогли пройти основной
сценарий. У нас сценарий двусторонний: клиент видит предложения только когда
их прислал проверенный мастер. Поэтому в App Review Information — **два
аккаунта**, оба по почте и паролю (телефонный вход требует российского
номера, ревьюеру его негде взять):

| Роль               | Логин                         | Пароль                      |
| ------------------ | ----------------------------- | --------------------------- |
| клиент             | `client.review@domio.invalid` | в App Store Connect, не тут |
| проверенный мастер | `master.review@domio.invalid` | в App Store Connect, не тут |

Аккаунты заводит `scripts/demo-review.mjs` (см. раздел 8). Пароли не
хранятся в репозитории: репозиторий публичный.

**Notes** (по-английски, ревьюеры читают английский):

> domio is a marketplace that connects homeowners with vetted repair
> professionals ("masters") in Grozny, Russia. There are no in-app payments
> and no in-app purchases: customers pay the master directly (cash or bank
> transfer), the app only records who chose which payment method.
>
> Two test accounts are provided. Sign in with the CUSTOMER account to see
> the main flow: tap an object on the isometric house (e.g. the kitchen
> sink), describe the problem, submit. Existing orders already show offers
> from the test master, an order in progress with chat, and a completed
> order with a review.
>
> To see the other side, sign out (Profile → «Выйти») and sign in with the
> MASTER account. The master account is already approved by a moderator;
> its "Я мастер" section shows the order feed, price offers and earnings.
> New masters submit a face photo and a phone number, which a human
> moderator reviews manually — there is no automated face recognition.
>
> Phone-number sign-in delivers the code by a robocall to Russian numbers
> only; please use the email accounts above. Camera access is used for a
> photo of the problem and for the master's verification selfie. Push
> notifications inform about new offers, messages and status changes.
>
> Account deletion is available in Profile → «Удалить аккаунт».

**Sign-in required:** да. **Contact:** телефон и почта владельца (Apple
может позвонить).

## 8. Демо-аккаунты: `scripts/demo-review.mjs`

Скрипт работает с боевым проектом от имени двух демо-пользователей теми же
записями, что делает приложение, — правила доступа те же. Секретов в нём нет,
пароли передаются переменными окружения:

```bash
DEMO_CLIENT_PASSWORD=… DEMO_MASTER_PASSWORD=… node scripts/demo-review.mjs accounts
```

Этап `accounts`: заводит оба аккаунта с профилями и согласиями, анкету
мастера с фотографией-заглушкой отправляет на проверку, у клиента создаёт
три заявки. Дальше **[владелец]**: в приложении, в разделе модерации,
одобрить анкету `master.review` — это единственный шаг, который скрипту
запрещён правилами.

```bash
DEMO_CLIENT_PASSWORD=… DEMO_MASTER_PASSWORD=… node scripts/demo-review.mjs scenario
```

Этап `scenario` (после одобрения): мастер присылает предложения, клиент
принимает одно, стороны переписываются, одна заявка проходит до отзыва.
Итог для ревьюера: заявка с предложениями, заявка в работе с чатом и
телефоном, завершённая с отзывом. Оба этапа можно повторять: второй прогон
ничего не дублирует.

Аккаунты — обычные пользователи: их можно удалить из приложения или в
консоли Firebase, когда ревью пройдено.

## 9. Отправка на ревью [владелец]

1. Версия 1.0 в App Store Connect: скриншоты 6.9", тексты из раздела 5,
   App Privacy из раздела 6, записка и аккаунты из раздела 7.
2. Сборка из TestFlight прикрепляется к версии («Build» → «+»).
3. Release: Manually release — чтобы одобренная версия не вышла раньше,
   чем найдены мастера.
4. Submit for Review. Обычно 1–3 дня; отказ приходит с текстом, на который
   можно ответить в Resolution Center без новой сборки, если дело в
   метаданных.

## 10. Google Play

- **Аккаунт разработчика** [владелец]: play.google.com/console, 25 $ разово.
  Для личного аккаунта, заведённого после ноября 2023, Google требует
  **закрытое тестирование: не меньше 12 тестировщиков в течение 14 дней**
  подряд до подачи в production. Планировать заранее: это две недели.
- **Сборка**: `eas build --profile production --platform android` даёт
  AAB, подписанный ключом EAS; при первой загрузке включить Play App
  Signing — ключ EAS станет upload key.
- **Отправка**: `eas submit --platform android --latest` требует JSON-ключ
  сервисного аккаунта Google Cloud с доступом к Play Console (Setup → API
  access). Первую версию проще загрузить руками в консоли.
- **Витрина**: название до 30, краткое описание до 80, полное до 4000 —
  тексты из раздела 5 подходят; скриншоты телефона — те же PNG; **feature
  graphic 1024×500** обязателен — `design/store/feature-graphic.png`.
- **Data safety** — ответы те же, что в разделе 6, в терминах Google:
  Personal info (name, email, phone, address), Photos, Messages, App
  activity (нет), Device IDs (нет), Financial (нет); данные шифруются при
  передаче; пользователь может запросить удаление (в приложении).
- **Content rating**: анкета IARC, ответы как в разделе 5; с чатом между
  пользователями итог обычно «12+».
- **Target audience**: 18+ (соглашение требует совершеннолетия).
- **Пуши**: ключ FCM V1 в EAS обязателен (см. RELEASE-PLAN, этап 4а).

## 11. RuStore

- Кабинет разработчика RuStore — на ИП или юрлицо с ИНН; для физлица без
  статуса публикация закрыта. Ещё одна причина регистрировать ИП первым.
- Загружается тот же AAB или APK production-профиля; RuStore сам
  подписывает, свой ключ не нужен.
- Модерация 1–3 рабочих дня; нужны политика конфиденциальности на русском
  (та же страница), описание, скриншоты, возрастная категория.
- Пуши в RuStore-сборке идут через FCM так же, как в Google Play, — на
  устройствах без сервисов Google (Huawei) они не придут; для них у RuStore
  свой push-сервис, это отдельная интеграция и не для запуска.

## Что блокирует прямо сейчас

1. Аккаунт Apple Developer и оплата — без него нет ни APNs, ни сборки iOS.
2. Публичная страница политики — нужны реквизиты ИП в `legal.ts` и деплой
   хостинга (OPERATOR-SETUP, шаги 2 и 4).
3. Одобрение демо-мастера в разделе модерации — один тап, но только с
   аккаунта модератора.
