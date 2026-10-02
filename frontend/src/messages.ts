import { ApiError } from './api';

// Maps the English BAD_REQUEST messages raised in supabase.ts to Bulgarian.
function badRequestText(message: string): string {
  if (/^date/i.test(message)) return 'Невалидна дата.';
  if (/^item/i.test(message)) return 'Описанието трябва да е от 1 до 100 символа.';
  if (/^price/i.test(message)) return 'Невалидна цена (над 0, до 2 цифри след запетаята).';
  if (/name/i.test(message) && /characters/i.test(message)) return 'Името трябва да е от 1 до 50 символа.';
  if (/category/i.test(message)) return 'Категорията не е налична. Избери друга.';
  return 'Невалидни данни.';
}

function notFoundText(message: string): string {
  if (/category/i.test(message)) return 'Категорията не е намерена. Може да е променена.';
  return 'Разходът не е намерен. Може вече да е изтрит.';
}

function conflictText(message: string): string {
  if (/category already/i.test(message)) return 'Вече съществува.';
  return 'Конфликт с други промени. Опитай пак.';
}

// uncertainWrite: the failed call was a write. Then NETWORK / SERVER_ERROR do not prove
// it was not saved, so the user must check before trying again (we never retry for them).
export function errorText(e: unknown, uncertainWrite = false): string {
  if (!(e instanceof ApiError)) return 'Неочаквана грешка.';
  switch (e.code) {
    case 'UNAUTHORIZED':
      return 'Грешно име или ПИН.';
    case 'FORBIDDEN':
      return 'Нямаш право на това действие.';
    case 'NOT_FOUND':
      return notFoundText(e.message);
    case 'CONFLICT':
      return conflictText(e.message);
    case 'BAD_REQUEST':
      return badRequestText(e.message);
    case 'NETWORK':
    case 'TIMEOUT':
    case 'SERVER_ERROR':
      if (uncertainWrite) return 'Не съм сигурен дали е записано. Провери в „Списък“, преди да опиташ пак.';
      if (e.code === 'TIMEOUT') return 'Сървърът не отговори навреме (30 секунди). Опитай пак.';
      return e.code === 'NETWORK' ? 'Няма връзка със сървъра. Опитай пак.' : 'Грешка в сървъра. Опитай пак.';
  }
}
