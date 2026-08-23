import { Redirect } from 'expo-router';
import { MasterDemoScreen } from '../screens/MasterDemoScreen';

// Витрина раздела мастера для промо-материалов и App Review: настоящий
// раздел открывается только проверенному мастеру, показать его снаружи
// нечем. Только dev-сборка — по той же причине, что и /demo: вымышленные
// клиенты и отзывы в проде выглядели бы настоящими.
export default function DemoMasterRoute() {
  if (!__DEV__) return <Redirect href="/login" />;
  return <MasterDemoScreen />;
}
