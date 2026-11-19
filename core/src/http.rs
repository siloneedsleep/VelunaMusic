use reqwest::{redirect::Policy, Client};
use std::time::Duration;

pub fn build_client(timeout: Duration, user_agent: Option<&str>) -> Result<Client, reqwest::Error> {
    let mut builder = Client::builder().timeout(timeout);
    if let Some(ua) = user_agent {
        builder = builder.user_agent(ua);
    }
    builder.build()
}

pub fn build_stream_client(
    connect_timeout: Duration,
    read_timeout: Duration,
) -> Result<Client, reqwest::Error> {
    Client::builder()
        .redirect(Policy::none())
        .connect_timeout(connect_timeout)
        .read_timeout(read_timeout)
        .build()
}
