import { ApiError } from './api';

// Maps the server's English BAD_REQUEST messages to Bulgarian.
function badRequestText(message: string): string {
  if (/^date/.test(message)) return 'Невалидна дата.';
  if (/^item/.test(message)) return 'Описанието трябва да е от 1 до 100 символа.';
  if (/^price/.test(message)) return 'Невалидна цена (над 0, до 2 цифри след запетаята).';
  if (/category/i.test(message)) return 'Категорията не е налична. Избери друга.';
  return 'Невалидни данни.';
}

// uncertainWrite: the failed call was a write. Then NETWORK / SERVER_ERROR do not prove
// it was not saved, so the user must check before trying again (we never retry for them).
export function errorText(e: unknown, uncertainWrite = false): string {
  if (!(e instanceof ApiError)) return 'Неочаквана грешка.';
  switch (e.code) {
    case 'UNAUTHORIZED':
      return 'Грешно име или ПИН.';
    case 'LOCKED':
      return 'Твърде много опити. Опитай отново след 15 минути.';
    case 'FORBIDDEN':
      return 'Нямаш право на това действие.';
    case 'NOT_FOUND':
      return 'Не е намерено.';
    case 'CONFLICT':
      return 'Конфликт с други промени. Опитай пак.';
    case 'BAD_REQUEST':
      return badRequestText(e.message);
    case 'NETWORK':
    case 'SERVER_ERROR':
      if (uncertainWrite) return 'Не съм сигурен дали е записано. Провери в списъка, преди да опиташ пак.';
      return e.code === 'NETWORK' ? 'Няма връзка със сървъра. Опитай пак.' : 'Грешка в сървъра. Опитай пак.';
  }
}
