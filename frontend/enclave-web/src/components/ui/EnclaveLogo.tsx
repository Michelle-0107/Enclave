type Props = { className?: string; white?: boolean };
/** Reuses the existing transparent emblem. CSS colors its complete silhouette,
 * including the original outline, without modifying the source image. */
export default function EnclaveLogo({ className = '', white = false }: Props) {
  return <span aria-hidden="true" className={`enclave-emblem ${className}`} style={{ backgroundColor: white ? '#FFFFFF' : '#526B8A' }} />;
}
