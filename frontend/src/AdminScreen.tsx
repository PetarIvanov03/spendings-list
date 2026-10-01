import { useState } from 'react';
import type { Session } from './auth';
import { ChipRow } from './components';
import { AdminCategories } from './AdminCategories';
import { AdminUsers } from './AdminUsers';

// Admin tab. Only shown to admins, but that is cosmetic: the server checks every call.
export function AdminScreen({ user }: { user: Session['user'] }) {
  const [section, setSection] = useState<string | null>('categories');
  return (
    <section className="page">
      <ChipRow
        label="Раздел"
        value={section}
        onChange={setSection}
        items={[
          { value: 'categories', label: 'Категории' },
          { value: 'users', label: 'Хора' },
        ]}
      />
      {section === 'categories' ? <AdminCategories /> : <AdminUsers me={user} />}
    </section>
  );
}
