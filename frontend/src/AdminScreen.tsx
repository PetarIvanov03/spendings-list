import { useState } from 'react';
import { ChipRow } from './components';
import { AdminCategories } from './AdminCategories';
import { AdminTrash } from './AdminTrash';

// Admin tab. Only shown to admins, but that is cosmetic: the server checks every call.
export function AdminScreen() {
  const [section, setSection] = useState<string | null>('categories');
  return (
    <section className="page">
      <ChipRow
        segmented
        label="Раздел"
        value={section}
        onChange={setSection}
        items={[
          { value: 'categories', label: 'Категории' },
          { value: 'trash', label: 'Кошче' },
        ]}
      />
      {section === 'categories' ? <AdminCategories /> : <AdminTrash />}
    </section>
  );
}
