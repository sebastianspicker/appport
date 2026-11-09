//! Concurrent independent catalog reads, with heap-allocated HTTP futures.

use std::{
    future::{poll_fn, Future},
    task::Poll,
};

pub(super) fn join2<A: Future, B: Future>(
    first: A,
    second: B,
) -> impl Future<Output = (A::Output, B::Output)> {
    let mut first = Box::pin(first);
    let mut second = Box::pin(second);
    let mut first_output = None;
    let mut second_output = None;
    poll_fn(move |context| {
        if first_output.is_none() {
            if let Poll::Ready(output) = first.as_mut().poll(context) {
                first_output = Some(output);
            }
        }
        if second_output.is_none() {
            if let Poll::Ready(output) = second.as_mut().poll(context) {
                second_output = Some(output);
            }
        }
        match (first_output.take(), second_output.take()) {
            (Some(first), Some(second)) => Poll::Ready((first, second)),
            (first, second) => {
                first_output = first;
                second_output = second;
                Poll::Pending
            }
        }
    })
}

pub(super) fn join3<A: Future, B: Future, C: Future>(
    first: A,
    second: B,
    third: C,
) -> impl Future<Output = (A::Output, B::Output, C::Output)> {
    let joined = join2(join2(first, second), third);
    async move {
        let ((first, second), third) = joined.await;
        (first, second, third)
    }
}

/// Runs every future concurrently and returns their outputs in input order.
pub(super) fn join_all<F: Future>(futures: Vec<F>) -> impl Future<Output = Vec<F::Output>> {
    let mut pending = futures.into_iter().map(Box::pin).collect::<Vec<_>>();
    let mut outputs = pending.iter().map(|_| None).collect::<Vec<_>>();
    poll_fn(move |context| {
        for (future, output) in pending.iter_mut().zip(outputs.iter_mut()) {
            if output.is_none() {
                if let Poll::Ready(value) = future.as_mut().poll(context) {
                    *output = Some(value);
                }
            }
        }
        if outputs.iter().all(Option::is_some) {
            Poll::Ready(outputs.iter_mut().filter_map(Option::take).collect())
        } else {
            Poll::Pending
        }
    })
}
