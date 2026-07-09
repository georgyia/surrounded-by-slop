interface GreetingProps {
  name: string;
}

/** Renders a greeting. */
export function Greeting(props: GreetingProps) {
  return <span className="greeting">{props.name}</span>;
}

export const Farewell = (props: GreetingProps) => <span>{props.name}</span>;
