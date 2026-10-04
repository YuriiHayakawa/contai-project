export interface UserMessageProps {
  content: string;
}

/** Pergunta do usuário: balão à direita, com o canto inferior direito reto. */
export function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-lg rounded-br-[0.25rem] bg-primary px-4 py-2.5 text-body wrap-anywhere whitespace-pre-wrap text-on-primary">
        <span className="sr-only">Você: </span>
        {content}
      </p>
    </div>
  );
}
