import { SCENE_OBJECT_GROUPS } from '../HouseScene';
import { categoryFor, KNOWN_OBJECT_IDS } from '../serviceOptions';

// Сцена дома и каталог услуг живут в разных файлах и меняются порознь.
// Эти проверки держат их вместе — оба разрыва тихие: дерево услуг без
// объекта на сцене никто никогда не увидит, а два объекта с одним id
// перепутали бы заявки и серверные напоминания.

const sceneIds = SCENE_OBJECT_GROUPS.flatMap((group) => group.objects.map((o) => o.id));

test('каждое дерево услуг доступно со сцены', () => {
  KNOWN_OBJECT_IDS.forEach((id) => {
    expect(sceneIds).toContain(id);
  });
});

test('идентификаторы объектов сцены не повторяются', () => {
  expect(new Set(sceneIds).size).toBe(sceneIds.length);
});

// «Разное» — запасной выход categoryFor, а не осознанное решение: объект,
// попавший туда, скорее всего просто забыли разложить по специальностям
test('каждый объект сцены разложен по специальности, а не свален в «разное»', () => {
  sceneIds.forEach((id) => {
    expect(categoryFor(id)).not.toBe('разное');
  });
});
