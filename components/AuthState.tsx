import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { auth } from '../firebaseConfig';

// Сессия пользователя. Один аккаунт на человека: клиент и мастер — это один
// и тот же вход, роль мастера добавляется отдельной анкетой masters/{uid}.

type AuthState = {
  user: User | null;
  // true, пока Firebase восстанавливает сохранённую сессию — в это время
  // нельзя показывать экран входа, иначе он мигнёт у вошедшего пользователя
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  // Firebase не даёт удалить аккаунт по старой сессии — сначала повторный
  // вход. Заодно это проверка, что телефон в руках у владельца.
  reauthenticate: (password: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth вызван вне AuthProvider');
  return ctx;
}

// Firebase отдаёт коды вида auth/invalid-credential — переводим в человеческие
// формулировки, не подсказывая злоумышленнику, что именно не совпало
export function authErrorText(e: unknown): string {
  const code =
    typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : '';
  switch (code) {
    case 'auth/invalid-email':
      return 'Похоже, в email опечатка';
    case 'auth/email-already-in-use':
      return 'Такой email уже зарегистрирован — войдите';
    case 'auth/weak-password':
      return 'Пароль слишком простой — не короче 6 символов';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Неверный email или пароль';
    case 'auth/too-many-requests':
      return 'Слишком много попыток. Попробуйте через несколько минут';
    case 'auth/network-request-failed':
      return 'Нет связи с сервером. Проверьте интернет';
    case 'auth/operation-not-allowed':
      return 'Вход по email отключён в настройках Firebase';
    case 'auth/configuration-not-found':
      // Раздел Authentication в проекте Firebase ещё не включён — дело не в пароле
      return 'Авторизация не настроена в проекте Firebase';
    case 'auth/missing-password':
      return 'Введите пароль';
    case 'auth/requires-recent-login':
      return 'Сессия устарела — войдите заново и повторите';
    default:
      return 'Не удалось войти. Попробуйте ещё раз';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setInitializing(false);
      }),
    [],
  );

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  };

  const register = async (name: string, email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    // Имя кладём в сам аккаунт — профиль в Firestore создаст AppState,
    // когда получит uid: так запись всегда проходит под нужными правами
    await updateProfile(cred.user, { displayName: name.trim() });
    setUser({ ...cred.user, displayName: name.trim() } as User);
  };

  // Письмо со ссылкой на смену пароля. Firebase не сообщает, есть ли такой
  // аккаунт, и мы тоже не сообщаем: иначе форма превратится в способ
  // проверять, зарегистрирован ли человек в сервисе.
  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim().toLowerCase());
  };

  const logout = async () => {
    await signOut(auth);
  };

  // Работаем с auth.currentUser, а не с user из состояния: после register
  // туда кладётся копия объекта, у которой нет методов настоящего User.
  const reauthenticate = async (password: string) => {
    const current = auth.currentUser;
    if (!current?.email) throw new Error('Сессия не найдена — войдите заново');
    await reauthenticateWithCredential(
      current,
      EmailAuthProvider.credential(current.email, password),
    );
  };

  const deleteAccount = async () => {
    const current = auth.currentUser;
    if (!current) throw new Error('Сессия не найдена — войдите заново');
    await deleteUser(current);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        initializing,
        signIn,
        register,
        resetPassword,
        logout,
        reauthenticate,
        deleteAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
