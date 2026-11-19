import { useState } from 'react';
import { ChipRow } from './components';
import { AdminCategories } from './AdminCategories';
import { AdminTrash } from './AdminTrash';
import { useDesktop } from './useMediaQuery';

// Admin tab. Only shown to admins, but that is cosmetic: the server checks every call.
// Phones: one section at a time. Desktop: both side by side.
export function AdminScreen() {
  const [section, setSection] = useState<string | null>('categories');
  const desktop = useDesktop();
  if (desktop) {
    return (
      <section className="page admin-grid">
        <div>
          <h2 className="section-title">Категории</h2>
          <AdminCategories />
        </div>
        <div>
          <h2 className="section-title">Кошче</h2>
          <AdminTrash />
        </div>
      </section>
    );
  }
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
