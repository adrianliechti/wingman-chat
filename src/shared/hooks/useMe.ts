import { useEffect, useState } from "react";

export interface Me {
  name?: string;
  email?: string;
}

export function useMe(): Me {
  const [me, setMe] = useState<Me>({});

  useEffect(() => {
    let active = true;

    fetch("/me")
      .then((resp) => (resp.ok ? resp.json() : {}))
      .then((data: Me) => {
        if (active) setMe(data);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  return me;
}
