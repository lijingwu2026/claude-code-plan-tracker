# Progress

| task | status | evidence |
|---|---|---|
| 1. Create greet.py with greet(name) | Done | `python3 -c "import greet;print(greet.greet('Ada'))"` printed `Hello, Ada!` |
| 2. Create test_greet.py and run python3 -m unittest -v | Done | `python3 -m unittest -v`: test_greet_ada ... ok; Ran 1 test; OK |
| 3. Create NOTES.md with how to run the test | Done | `grep -c unittest NOTES.md` printed `1` |
