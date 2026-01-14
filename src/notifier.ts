export type Notification = {
  title: string;
  body: string;
  url: string;
  picurl: string;
};

export type NotifyCallback = (notification: Notification) => void;

export const notify_custom = async (
  url: string | URL | Request,
  notification: Notification,
  token?: string,
) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-Key": token,
    },
    body: new URLSearchParams(notification),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
};
