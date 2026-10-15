import Image from 'next/image';
import Link from 'next/link';

const notifications = [
  {
    id: 'notification-1',
    title: 'Repair ready for verification',
    message: 'Maintenance team submitted #HP-1012.',
    time: '10 min ago',
    href: '/management/reports/HP-1012/verify',
  },
  {
    id: 'notification-2',
    title: 'Resident added information',
    message: 'New details received for #HP-1025.',
    time: '1 hour ago',
    href: '/management/reports/HP-1025',
  },
  {
    id: 'notification-3',
    title: 'New report submitted',
    message: 'Streetlight issue at Park Entrance.',
    time: '2 hours ago',
    href: '/management/reports/HP-1024',
  },
];

export default function ManagementNotificationsPage() {
  return (
    <div className="flex flex-col gap-7">
      <h1 className="text-[30px] font-semibold leading-[1.45] text-primary lg:text-[36px]">
        Notifications.
      </h1>

      <p className="text-sm leading-relaxed text-muted-foreground">
        Reports and repairs that need your attention.
      </p>

      <ul className="m-0 list-none p-0">
        {notifications.map((notification) => (
          <li
            key={notification.id}
            className="border-b border-border"
          >
            <Link
              href={notification.href}
              className="flex items-center gap-4 py-7 transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            >
              <div className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-enclave-lavender">
                <Image
                  src="/images/enclave-logo.png"
                  alt=""
                  width={24}
                  height={29}
                  className="object-contain"
                />
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <h2 className="text-base font-semibold leading-relaxed text-primary">
                  {notification.title}
                </h2>

                <p className="text-sm leading-relaxed text-muted-foreground">
                  {notification.message}
                </p>

                <p className="text-xs text-muted-foreground">
                  {notification.time}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Sample notifications and times. Live notifications
        will be connected through the backend.
      </p>
    </div>
  );
}