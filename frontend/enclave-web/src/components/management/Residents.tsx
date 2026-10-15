'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const residents = [
  {
    id: 'resident-1',
    fullName: 'Florence Chow',
    email: 'florence@example.com',
    unit: 'A-12-03',
    accountLinked: true,
  },
  {
    id: 'resident-2',
    fullName: 'Daniel Tan',
    email: 'daniel@example.com',
    unit: 'B-08-02',
    accountLinked: false,
  },
];

export default function Residents() {
  const [search, setSearch] = useState('');

  const keyword = search.trim().toLowerCase();

  const filteredResidents = residents.filter((resident) =>
    [
      resident.fullName,
      resident.email,
      resident.unit,
    ].some((value) => value.toLowerCase().includes(keyword)),
  );

  return (
    <div className="flex flex-col gap-7">
      <h1 className="text-[30px] font-semibold leading-[1.45] text-primary lg:text-[36px]">
        Resident records.
      </h1>

      <p className="text-sm leading-relaxed text-muted-foreground">
        Verified in person. One resident record can link to
        one account.
      </p>

      <Link
        href="/management/residents/new"
        className="flex min-h-[52px] items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:opacity-90 sm:w-[220px]"
      >
        Add resident
      </Link>

      <div className="flex flex-col gap-2">
        <Label
          htmlFor="resident-search"
          className="text-sm font-semibold"
        >
          Find a resident
        </Label>

        <Input
          id="resident-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, email or unit"
          className="h-[54px] rounded-2xl bg-white px-4 text-sm shadow-none"
        />
      </div>

      <ul className="m-0 list-none p-0">
        {filteredResidents.map((resident) => (
          <li
            key={resident.id}
            className="flex flex-col gap-2 border-b border-border py-7 first:pt-0"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <h2 className="text-lg font-semibold text-primary">
                {resident.fullName}
              </h2>

              <p
                className={`text-xs sm:w-[218px] ${
                  resident.accountLinked
                    ? 'text-status-green'
                    : 'text-status-orange'
                }`}
              >
                {resident.accountLinked
                  ? 'Account linked'
                  : 'Not registered'}
              </p>
            </div>

            <p className="break-words text-xs leading-relaxed text-muted-foreground">
              {resident.unit} · {resident.email}
            </p>
          </li>
        ))}
      </ul>

      {filteredResidents.length === 0 && (
        <p
          role="status"
          className="py-6 text-sm text-muted-foreground"
        >
          No residents found. Try another name, email or unit.
        </p>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Sample resident records. Live records will be
        connected through the backend.
      </p>
    </div>
  );
}