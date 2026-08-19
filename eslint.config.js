const expo = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');
const ts = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const globals = require('globals');

// Линтер.
//
// Смысл не в единообразии — за него отвечает Prettier, — а в ошибках, которые
// компилятор пропускает: забытая зависимость в useEffect (подписка на
// Firestore, которая не переподписалась), незамеченный `await`, мёртвый код.
//
// Три среды с разными правилами. Приложение — React Native. functions/ —
// Node, там React нет, зато есть деньги и Admin SDK без правил доступа.
// scripts/ и тесты — вспомогательное, требования ниже.

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'functions/node_modules/**',
      'functions/lib/**',
      '.expo/**',
      'dist/**',
      'android/**',
      'ios/**',
    ],
  },

  // ---------- приложение ----------
  ...expo,
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'screens/**/*.{ts,tsx}'],
    rules: {
      // Подписки на Firestore живут в useEffect. Забытая зависимость означает
      // подписку на старый город или старого пользователя — данные при этом
      // приходят, просто не те. Компилятор такого не видит.
      'react-hooks/exhaustive-deps': 'error',

      // Переменная, оставшаяся от предыдущей правки, — обычно недоделка.
      // Осознанно пропущенный аргумент называют с подчёркивания.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],

      // `if (x = 1)` вместо `==`
      'no-cond-assign': 'error',
      // Промах, который тихо теряет ошибку
      'no-async-promise-executor': 'error',
    },
  },

  // ---------- Cloud Functions ----------
  {
    files: ['functions/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      globals: globals.node,
      // Разбор с типами — ради no-floating-promises ниже. Без типов он
      // не работает вовсе.
      parserOptions: {
        project: './functions/tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    plugins: { '@typescript-eslint': ts },
    rules: {
      // Главное правило этого раздела. Незамеченный `await` в обработчике
      // вебхука означает ответ 200 до того, как запись дошла до базы, —
      // и провайдер больше не повторит уведомление. Функция при этом
      // завершается, а запись теряется.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],

      'no-cond-assign': 'error',
      'no-async-promise-executor': 'error',
    },
  },

  // ---------- скрипты, настройка тестов и сами тесты ----------
  {
    files: [
      'scripts/**/*.{js,mjs}',
      'jest.setup.js',
      '*.config.js',
      '**/__tests__/**/*.{ts,tsx}',
      'tests/**/*.{js,mjs}',
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      // В заглушках полно аргументов, которые нужны для формы, а не для дела
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Отключает всё, что спорит с Prettier. Обязан идти последним.
  prettier,
];
